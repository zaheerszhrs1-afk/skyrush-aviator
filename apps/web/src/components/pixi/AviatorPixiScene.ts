import * as PIXI from "pixi.js";
import type { RoundSnapshot } from "../../types";

const CRASH_SCREEN_MS = 3000;
const WAITING_SCREEN_MS = 8000;
const PRELOAD_WINDOW_MS = 1200;
const MULTIPLIER_GROWTH_PER_MS = 0.00006;
// The server deliberately sends a two-decimal authoritative multiplier. At low
// values that means the target position advances in visible steps (1.00, 1.01,
// 1.02...). Follow those steps with a short exponential response instead of
// racing to every target and stopping between packets. This keeps the plane
// fluid while it always remains at or behind the authoritative multiplier.
const FLIGHT_FOLLOW_RESPONSE_MS = 82;
const PLANE_RENDER_WIDTH = 190;
const PLANE_SOURCE_WIDTH = 476;
const PLANE_SOURCE_HEIGHT = 294;
const MAX_FLIGHT_PROGRESS = 0.94;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const easeOutCubic = (value: number) => 1 - Math.pow(1 - value, 3);
const easeInCubic = (value: number) => value * value * value;
const flightElapsedFromMultiplier = (multiplier: number) =>
  multiplier <= 1 ? 0 : Math.log(multiplier) / MULTIPLIER_GROWTH_PER_MS;

type FlightPoint = {
  x: number;
  y: number;
  progress: number;
};

export class AviatorPixiScene {
  private readonly host: HTMLElement;
  private readonly PIXI: any = PIXI;
  private app: any;
  private resizeObserver?: ResizeObserver;
  private round: RoundSnapshot;
  private previousPhase: RoundSnapshot["phase"];
  private crashStartedAt = 0;
  private lastFlightPoint: FlightPoint = { x: 0, y: 0, progress: 0 };
  private elapsedAnimation = 0;
  private visualFlightElapsed = 0;
  private rayRotation = 0;
  private serverClockOffsetMs = 0;
  private hasServerClockSample = false;

  private background: any;
  private rays: any;
  private glow: any;
  private curveFill: any;
  private curveLine: any;
  private curveHighlight: any;
  private plane: any;
  private propeller: any;
  private multiplierText: any;
  private statusText: any;
  private waitingText: any;
  private waitingBar: any;
  private audience: any;
  private audienceBackground: any;
  private audienceText: any;

  constructor(host: HTMLElement, initialRound: RoundSnapshot) {
    this.host = host;
    this.round = initialRound;
    this.previousPhase = initialRound.phase;
    if (initialRound.roundId !== "loading" && Number.isFinite(initialRound.serverTime)) {
      this.serverClockOffsetMs = initialRound.serverTime - Date.now();
      this.hasServerClockSample = true;
    }
    this.visualFlightElapsed = initialRound.phase === "RUNNING"
      ? flightElapsedFromMultiplier(initialRound.multiplier)
      : 0;
  }

  async init(): Promise<void> {
    const { Application, Container, Graphics, Text } = this.PIXI;

    this.app = new Application();
    await this.app.init({
      width: Math.max(1, this.host.clientWidth),
      height: Math.max(1, this.host.clientHeight),
      background: 0x050607,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      preference: "webgl",
      powerPreference: "high-performance"
    });

    this.app.canvas.className = "pixi-game-canvas";
    this.app.canvas.setAttribute("aria-label", "Live flight multiplier animation");
    this.host.replaceChildren(this.app.canvas);

    this.background = new Graphics();
    this.rays = new Graphics();
    this.glow = new Graphics();
    this.curveFill = new Graphics();
    this.curveLine = new Graphics();
    this.curveHighlight = new Graphics();

    this.plane = await this.createPlane();

    this.statusText = new Text({
      text: "",
      style: {
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 34,
        fontWeight: "500",
        fill: 0xffffff,
        align: "center"
      }
    });
    this.statusText.anchor.set(0.5);

    this.multiplierText = new Text({
      text: "1.00x",
      style: {
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 104,
        fontWeight: "700",
        fill: 0xffffff,
        align: "center",
        letterSpacing: -4
      }
    });
    this.multiplierText.anchor.set(0.5);

    this.waitingText = new Text({
      text: "WAITING FOR NEXT ROUND",
      style: {
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 20,
        fontWeight: "600",
        fill: 0xe5e7eb,
        align: "center",
        letterSpacing: 0.5
      }
    });
    this.waitingText.anchor.set(0.5);

    this.waitingBar = new Graphics();
    this.audience = new Container();
    this.audienceBackground = new Graphics();
    this.audienceText = new Text({
      text: "0",
      style: {
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 14,
        fontWeight: "700",
        fill: 0xf4f4f5
      }
    });
    this.audience.addChild(this.audienceBackground);
    this.addAudienceAvatars(this.audience);
    this.audience.addChild(this.audienceText);

    this.app.stage.addChild(
      this.background,
      this.rays,
      this.glow,
      this.curveFill,
      this.curveLine,
      this.curveHighlight,
      this.plane,
      this.statusText,
      this.multiplierText,
      this.waitingText,
      this.waitingBar,
      this.audience
    );

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.host);
    this.app.ticker.add((ticker: any) => this.tick(ticker.deltaMS));

    this.resize();
    this.renderFrame();
  }

  setRound(round: RoundSnapshot): void {
    const previousRound = this.round;
    const roundChanged = round.roundId !== previousRound.roundId;
    const phaseChanged = round.phase !== this.previousPhase;
    if (Number.isFinite(round.serverTime)) {
      const observedOffset = round.serverTime - Date.now();
      // Keep the best (least network-delayed) clock sample so the countdown
      // cannot jump backwards when one packet takes a slower route.
      this.serverClockOffsetMs = this.hasServerClockSample
        ? Math.max(this.serverClockOffsetMs, observedOffset)
        : observedOffset;
      this.hasServerClockSample = true;
    }

    if (round.phase === "WAITING") {
      this.visualFlightElapsed = 0;
    } else if (round.phase === "RUNNING") {
      const targetElapsed = flightElapsedFromMultiplier(round.multiplier);
      const isFreshTakeoff = !roundChanged && previousRound.phase === "WAITING";

      if (isFreshTakeoff) {
        // Begin at the launch position. The plane must not run ahead while the
        // displayed authoritative multiplier is still 1.00x.
        this.visualFlightElapsed = 0;
      } else if (roundChanged || this.visualFlightElapsed > targetElapsed) {
        // Reconnects or corrected packets should snap to the authoritative
        // position instead of replaying an old flight.
        this.visualFlightElapsed = targetElapsed;
      }
    }

    if (phaseChanged) {
      if (round.phase === "CRASHED") {
        this.crashStartedAt = performance.now();
      }
      this.previousPhase = round.phase;
    }
    this.round = round;
    if (this.audienceText) {
      this.audienceText.text = String(Math.max(0, round.online + round.automatedOnline));
    }
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;

    if (this.app) {
      this.app.destroy(
        { removeView: true, releaseGlobalResources: true },
        { children: true, texture: true, textureSource: true }
      );
      this.app = undefined;
    }
  }

  private resize(): void {
    if (!this.app) return;
    const width = Math.max(1, Math.floor(this.host.clientWidth));
    const height = Math.max(1, Math.floor(this.host.clientHeight));
    this.app.renderer.resize(width, height);
    this.drawStaticScene(width, height);
    this.layoutText(width, height);
    this.drawAudience(width, height);
  }

  private tick(deltaMS: number): void {
    this.elapsedAnimation += deltaMS;

    if (this.round.phase === "RUNNING") {
      const targetElapsed = flightElapsedFromMultiplier(this.round.multiplier);
      if (this.visualFlightElapsed > targetElapsed) {
        this.visualFlightElapsed = targetElapsed;
      } else {
        // Exponential following preserves a continuous velocity between the
        // server's rounded multiplier steps. It never overshoots targetElapsed,
        // so the animation remains smooth without reintroducing a live/final
        // multiplier mismatch.
        const gap = targetElapsed - this.visualFlightElapsed;
        const response = 1 - Math.exp(-Math.max(0, deltaMS) / FLIGHT_FOLLOW_RESPONSE_MS);
        this.visualFlightElapsed = Math.min(
          targetElapsed,
          this.visualFlightElapsed + gap * response
        );
      }
      this.rayRotation = (this.rayRotation + deltaMS * 0.00009) % (Math.PI * 2);
    } else if (this.round.phase === "CRASHED") {
      this.rayRotation = (this.rayRotation + deltaMS * 0.000045) % (Math.PI * 2);
    } else {
      this.rayRotation *= 0.92;
      if (Math.abs(this.rayRotation) < 0.0001) this.rayRotation = 0;
    }

    if (this.rays) {
      this.rays.rotation = this.rayRotation;
    }

    this.renderFrame();
  }

  private renderFrame(): void {
    if (!this.app) return;
    const width = this.app.screen.width;
    const height = this.app.screen.height;
    const now = this.getServerNow();
    const phase = this.round.phase;

    if (phase === "WAITING") {
      // Keep the countdown/preloaded 1.00x frame visible until the reliable
      // round:started packet arrives. The client no longer guesses takeoff from
      // its own clock, so there is no plane-first or multiplier-first frame.
      this.renderWaiting(width, height, now);
      return;
    }

    if (phase === "CRASHED") {
      this.renderCrashed(width, height);
      return;
    }

    this.renderRunning(width, height);
  }

  private renderWaiting(width: number, height: number, now: number): void {
    const remaining = this.round.phaseEndsAt ? Math.max(0, this.round.phaseEndsAt - now) : 0;
    const preload = remaining <= PRELOAD_WINDOW_MS;
    const waitingProgress = clamp(1 - remaining / WAITING_SCREEN_MS, 0, 1);

    this.glow.alpha = preload ? 0.24 : 0.12;
    this.curveFill.clear();
    this.curveLine.clear();
    this.curveHighlight.clear();
    this.plane.visible = true;
    this.plane.alpha = preload ? 1 : 0.78;

    const launchPoint = this.calculateFlightPoint(width, height, 0);
    const idleX = launchPoint.x + Math.sin(this.elapsedAnimation / 900) * Math.max(1.2, width * 0.0015);
    const idleY = launchPoint.y + Math.sin(this.elapsedAnimation / 430) * Math.max(1.2, height * 0.003);
    const idleScale = preload ? 1 : 0.92 + Math.sin(this.elapsedAnimation / 700) * 0.006;
    this.plane.position.set(idleX, idleY);
    this.plane.rotation =
      -0.03 +
      Math.sin(this.elapsedAnimation / 600) * 0.012 +
      Math.sin(this.elapsedAnimation / 240) * 0.003;
    this.plane.scale.set(this.getPlaneScale(width, height) * idleScale);
    this.spinPropeller(preload ? 2.2 : 1.3);

    this.statusText.visible = false;
    this.waitingText.visible = true;
    this.waitingText.position.set(width * 0.5, preload ? height * 0.63 : height * 0.46);
    this.waitingText.style.fontSize = clamp(height * 0.052, 17, 25);

    if (preload) {
      // Preload the multiplier before takeoff. At zero we show STARTING... until
      // the server confirms RUNNING, rather than letting the plane move alone.
      this.multiplierText.visible = true;
      this.multiplierText.text = "1.00x";
      this.multiplierText.style.fill = 0xffffff;
      this.multiplierText.position.set(width * 0.51, height * 0.44);
      this.multiplierText.alpha = 1;
      this.waitingText.text = remaining > 0
        ? `STARTING IN ${(remaining / 1000).toFixed(1)}s`
        : "STARTING...";
    } else {
      this.multiplierText.visible = false;
      this.waitingText.text = `NEXT ROUND IN ${Math.max(1, Math.ceil(remaining / 1000))}s`;
    }

    const barWidth = clamp(width * 0.34, 180, 420);
    const barHeight = 8;
    const barX = (width - barWidth) / 2;
    const barY = preload ? height * 0.69 : height * 0.54;
    this.waitingBar.visible = true;
    this.waitingBar.clear();
    this.waitingBar.roundRect(barX, barY, barWidth, barHeight, barHeight / 2).fill({ color: 0x26282c, alpha: 1 });
    this.waitingBar.roundRect(barX, barY, barWidth * waitingProgress, barHeight, barHeight / 2).fill({ color: 0xff0048, alpha: 1 });

    this.audience.visible = true;
  }

  private renderRunning(
    width: number,
    height: number,
    multiplier: number = this.round.multiplier
  ): void {
    // Plane position is derived from the same latest authoritative multiplier
    // shown on screen. It stays at takeoff while the value is 1.00x and starts
    // moving on the exact frame the displayed multiplier begins increasing.
    const elapsed = multiplier <= 1 ? 0 : this.visualFlightElapsed;
    // The multiplier text must remain authoritative. Extrapolating it from the
    // client clock can run ahead of the server because of clock skew or a
    // delayed crash packet, making the live value higher than the final result.
    // Render only the latest server multiplier so the live and FLEW AWAY
    // values can never contradict. Plane travel uses the same authoritative
    // progression rather than an independent client clock.
    const visualMultiplier = Number(Math.max(1, multiplier).toFixed(2));
    const inFlight = visualMultiplier > 1;
    const motionFactor = inFlight ? 1 : 0;
    const flightPoint = this.calculateFlightPoint(width, height, elapsed);
    // Fade the ambient flight motion in gradually during takeoff. The old
    // high-frequency wobble was fully active on the first movement frame and
    // made the launch look shaky on mobile displays.
    const takeoffBlend = easeOutCubic(clamp(flightPoint.progress / 0.16, 0, 1));
    const ambientMotion = motionFactor * takeoffBlend;
    const planeX =
      flightPoint.x +
      Math.sin(this.elapsedAnimation / 760) * Math.max(0.8, width * 0.00125) * ambientMotion;
    const planeY =
      flightPoint.y +
      Math.sin(this.elapsedAnimation / 520) * Math.max(1.1, height * 0.0035) * ambientMotion;
    const planeRotation =
      -0.048 +
      flightPoint.progress * -0.045 +
      Math.sin(this.elapsedAnimation / 620) * 0.009 * ambientMotion;
    const planeScale = this.getPlaneScale(width, height);
    const animatedPlaneScale = planeScale *
      (1 + Math.sin(this.elapsedAnimation / 720) * 0.0035 * ambientMotion);
    const tailPoint = this.calculatePlaneTailPoint(
      planeX,
      planeY,
      planeRotation,
      animatedPlaneScale,
      flightPoint.progress
    );

    this.lastFlightPoint = { x: planeX, y: planeY, progress: flightPoint.progress };
    this.drawFlightCurve(width, height, tailPoint);
    this.glow.alpha = clamp(0.28 + flightPoint.progress * 0.42, 0.28, 0.7);

    this.plane.visible = true;
    this.plane.alpha = 1;
    this.plane.position.set(planeX, planeY);
    this.plane.rotation = planeRotation;
    this.plane.scale.set(animatedPlaneScale);
    this.spinPropeller(2.4);

    this.statusText.visible = false;
    this.waitingText.visible = false;
    this.waitingBar.visible = false;
    this.multiplierText.visible = true;
    this.multiplierText.text = `${visualMultiplier.toFixed(2)}x`;
    this.multiplierText.style.fill = 0xffffff;
    this.multiplierText.position.set(width * 0.51, height * 0.48);
    this.multiplierText.alpha = 1;
    this.audience.visible = true;
  }

  private renderCrashed(width: number, height: number): void {
    const crashElapsed = this.crashStartedAt > 0 ? performance.now() - this.crashStartedAt : CRASH_SCREEN_MS;
    const flyProgress = clamp(crashElapsed / 520, 0, 1);
    const fadeProgress = easeInCubic(clamp(crashElapsed / 420, 0, 1));

    this.curveFill.alpha = 1 - fadeProgress;
    this.curveLine.alpha = 1 - fadeProgress;
    this.curveHighlight.alpha = 1 - fadeProgress;
    this.glow.alpha = Math.max(0, 0.36 * (1 - fadeProgress));

    if (flyProgress < 1) {
      const eased = easeOutCubic(flyProgress);
      this.plane.visible = true;
      this.plane.alpha = 1 - flyProgress;
      const departureWobble = Math.sin(flyProgress * Math.PI * 4) * (1 - flyProgress);
      this.plane.position.set(
        this.lastFlightPoint.x + width * 0.5 * eased,
        this.lastFlightPoint.y - height * 0.6 * eased + departureWobble * height * 0.018
      );
      this.plane.rotation = -0.1 - eased * 0.24 + departureWobble * 0.035;
      this.plane.scale.set(
        this.getPlaneScale(width, height) *
          (1 + eased * 0.12 + Math.sin(crashElapsed / 70) * 0.008 * (1 - flyProgress))
      );
      this.spinPropeller(3.4);
    } else {
      this.plane.visible = false;
    }

    // The page already renders the single authoritative next-round timer.
    // Keep the crash overlay focused on the result so users never see a
    // duplicate countdown underneath “FLEW AWAY!”.
    this.waitingText.visible = false;
    this.waitingBar.visible = false;
    this.waitingBar.clear();
    this.statusText.visible = true;
    this.statusText.text = "FLEW AWAY!";
    this.statusText.style.fontSize = clamp(height * 0.085, 28, 48);
    this.statusText.position.set(width * 0.5, height * 0.34);

    this.multiplierText.visible = true;
    this.multiplierText.text = `${(this.round.crashPoint ?? this.round.multiplier).toFixed(2)}x`;
    this.multiplierText.style.fill = 0xe40027;
    this.multiplierText.position.set(width * 0.5, height * 0.51);
    this.multiplierText.alpha = clamp(crashElapsed / 180, 0, 1);
    this.audience.visible = true;
  }

  private drawStaticScene(width: number, height: number): void {
    this.background.clear();
    this.background.roundRect(0, 0, width, height, 24).fill(0x030406);

    this.rays.clear();
    const originX = -Math.max(16, width * 0.015);
    const originY = height + Math.max(16, height * 0.015);
    const radius = Math.hypot(width, height) * 2.2;
    const rayCount = 48;
    const fullCircle = Math.PI * 2;
    const step = fullCircle / rayCount;

    for (let index = 0; index < rayCount; index += 1) {
      const angleA = -Math.PI + index * step;
      const angleB = angleA + step;
      const isBlue = index % 2 === 0;
      const color = isBlue ? 0x0a1821 : 0x000000;
      const alpha = isBlue ? 0.9 : 1;

      this.rays
        .poly([
          originX,
          originY,
          originX + Math.cos(angleA) * radius,
          originY + Math.sin(angleA) * radius,
          originX + Math.cos(angleB) * radius,
          originY + Math.sin(angleB) * radius
        ], true)
        .fill({ color, alpha });
    }

    this.rays.pivot.set(originX, originY);
    this.rays.position.set(originX, originY);
    this.rays.rotation = this.rayRotation;

    this.glow.clear();
    const glowX = width * 0.53;
    const glowY = height * 0.45;
    const glowWidth = width * 0.92;
    const glowHeight = height * 0.96;

    for (let index = 8; index >= 1; index -= 1) {
      const ratio = index / 8;
      this.glow
        .ellipse(glowX, glowY, glowWidth * ratio * 0.5, glowHeight * ratio * 0.5)
        .fill({ color: 0x0f6ea0, alpha: 0.018 + (1 - ratio) * 0.032 });
    }

    this.glow
      .ellipse(width * 0.52, height * 0.47, width * 0.22, height * 0.18)
      .fill({ color: 0x56c6ff, alpha: 0.07 });
  }

  private drawFlightCurve(width: number, height: number, point: FlightPoint): void {
    const startX = Math.max(26, width * 0.025);
    const baseY = height - Math.max(2, height * 0.008);
    const controlOneX = startX + Math.max(52, (point.x - startX) * 0.42);
    const controlOneY = baseY;
    const controlTwoX = point.x - Math.max(28, (point.x - startX) * 0.29);
    const controlTwoY = point.y + Math.max(16, (baseY - point.y) * 0.55);

    this.curveFill.alpha = 1;
    this.curveLine.alpha = 1;
    this.curveHighlight.alpha = 1;

    this.curveFill.clear();
    this.curveFill
      .moveTo(startX, baseY)
      .bezierCurveTo(controlOneX, controlOneY, controlTwoX, controlTwoY, point.x, point.y)
      .lineTo(point.x, baseY)
      .lineTo(startX, baseY)
      .closePath()
      .fill({ color: 0xb7003c, alpha: 0.58 });

    this.curveLine.clear();
    this.curveLine
      .moveTo(startX, baseY)
      .bezierCurveTo(controlOneX, controlOneY, controlTwoX, controlTwoY, point.x, point.y)
      .stroke({ color: 0xff0048, width: clamp(height * 0.009, 3, 5.5), cap: "round", join: "round" });

    this.curveHighlight.clear();
    this.curveHighlight
      .moveTo(startX, baseY - 1)
      .bezierCurveTo(controlOneX, controlOneY - 1, controlTwoX, controlTwoY - 1, point.x, point.y - 1)
      .stroke({ color: 0xff4c78, width: clamp(height * 0.0028, 1, 1.8), alpha: 0.72, cap: "round" });
  }

  private calculatePlaneTailPoint(
    planeX: number,
    planeY: number,
    rotation: number,
    scale: number,
    progress: number
  ): FlightPoint {
    // Local attachment point near the rear underside of the 190px-wide plane sprite.
    const localTailX = -78;
    const localTailY = 24;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);

    return {
      x: planeX + (localTailX * cos - localTailY * sin) * scale,
      y: planeY + (localTailX * sin + localTailY * cos) * scale,
      progress
    };
  }

  private calculateFlightPoint(width: number, height: number, elapsed: number): FlightPoint {
    const planeScale = this.getPlaneScale(width, height);
    const planeHalfWidth = (PLANE_RENDER_WIDTH * planeScale) / 2;
    const planeHalfHeight =
      (PLANE_RENDER_WIDTH * (PLANE_SOURCE_HEIGHT / PLANE_SOURCE_WIDTH) * planeScale) / 2;
    const horizontalMargin = clamp(width * 0.018, 14, 24);
    const verticalMargin = clamp(height * 0.04, 14, 22);

    // Position the plane by its real rendered bounds, not by the graph's bottom
    // edge. This keeps the entire sprite visible on desktop, short screens and
    // mobile while preserving the familiar bottom-left takeoff location.
    const startX = planeHalfWidth + horizontalMargin;
    const launchY = height - planeHalfHeight - verticalMargin;
    const maxX = Math.max(startX, width - planeHalfWidth - horizontalMargin);
    const topY = planeHalfHeight + verticalMargin;

    // Start from a true zero-progress point. Removing the previous 50 ms floor
    // eliminates the small frozen/jump transition at the first 1.01x update.
    const progress = clamp(Math.pow(Math.max(0, elapsed) / 9000, 0.6), 0, MAX_FLIGHT_PROGRESS);
    const routeProgress = progress / MAX_FLIGHT_PROGRESS;
    const x = startX + (maxX - startX) * routeProgress;
    const y = launchY -
      Math.pow(routeProgress, 1.82) * Math.max(0, launchY - topY) * 0.78;

    return { x, y, progress };
  }

  private getServerNow(): number {
    return Date.now() + this.serverClockOffsetMs;
  }

  private layoutText(width: number, height: number): void {
    this.multiplierText.style.fontSize = clamp(Math.min(width * 0.12, height * 0.27), 58, 128);
    this.statusText.style.fontSize = clamp(height * 0.085, 28, 48);
    this.waitingText.style.fontSize = clamp(height * 0.055, 18, 27);
  }

  private async createPlane(): Promise<any> {
    const { Assets, Container, Sprite } = this.PIXI;
    const plane = new Container();
    const texture = await Assets.load("/aviator-plane.png");
    const body = new Sprite(texture);

    body.anchor.set(0.5);
    body.scale.set(190 / texture.width);
    body.roundPixels = false;

    plane.addChild(body);
    plane.pivot.set(0, 0);
    this.propeller = undefined;

    return plane;
  }

  private spinPropeller(speed: number): void {
    if (!this.propeller) return;
    this.propeller.rotation += 0.46 * speed;
  }

  private getPlaneScale(width: number, height: number): number {
    return clamp(Math.min(width / 1100, height / 500), 0.68, 1.16);
  }

  private addAudienceAvatars(container: any): void {
    const { Graphics } = this.PIXI;
    const colors = [0x9d3ad1, 0x0ba3d5, 0xf1b522];

    colors.forEach((color, index) => {
      const avatar = new Graphics();
      const x = 19 + index * 19;
      avatar.circle(x, 19, 13).fill({ color: 0x101214, alpha: 1 }).stroke({ color: 0x30343a, width: 1 });
      avatar.circle(x, 17, 10).fill(color);
      avatar.circle(x, 14, 3.5).fill({ color: 0xffd4b4, alpha: 0.95 });
      avatar.ellipse(x, 24, 7, 5).fill({ color: index === 1 ? 0x123f68 : 0x4d163d, alpha: 0.95 });
      container.addChild(avatar);
    });
  }

  private drawAudience(width: number, height: number): void {
    const pillWidth = 138;
    const pillHeight = 38;
    this.audience.position.set(width - pillWidth - 9, height - pillHeight - 8);
    this.audienceBackground.clear();
    this.audienceBackground
      .roundRect(0, 0, pillWidth, pillHeight, pillHeight / 2)
      .fill({ color: 0x111315, alpha: 0.94 })
      .stroke({ color: 0x1e2226, width: 1 });
    this.audienceText.position.set(76, 11);
    this.audienceText.text = String(Math.max(0, this.round.online + this.round.automatedOnline));
  }
}
