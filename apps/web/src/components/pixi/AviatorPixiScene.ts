import * as PIXI from "pixi.js";
import type { RoundSnapshot } from "../../types";

const FLIGHT_CURVE_RATE = 0.00006;
const CRASH_SCREEN_MS = 3000;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const easeOutCubic = (value: number) => 1 - Math.pow(1 - value, 3);
const easeInCubic = (value: number) => value * value * value;

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
  private rayRotation = 0;

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
        fontSize: 15,
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
    if (round.phase !== this.previousPhase) {
      if (round.phase === "CRASHED") {
        this.crashStartedAt = performance.now();
      }
      this.previousPhase = round.phase;
    }
    this.round = round;
    if (this.audienceText) {
      this.audienceText.text = String(Math.max(0, round.online));
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
      this.rayRotation += deltaMS * 0.00009;
    } else if (this.round.phase === "CRASHED") {
      this.rayRotation += deltaMS * 0.000045;
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
    const now = Date.now();
    const phase = this.round.phase;

    if (phase === "WAITING") {
      this.renderWaiting(width, height, now);
      return;
    }

    if (phase === "CRASHED") {
      this.renderCrashed(width, height);
      return;
    }

    this.renderRunning(width, height, now);
  }

  private renderWaiting(width: number, height: number, now: number): void {
    const remaining = this.round.phaseEndsAt ? Math.max(0, this.round.phaseEndsAt - now) : 0;
    const seconds = Math.max(0, Math.ceil(remaining / 1000));
    const progress = clamp(1 - remaining / 8000, 0, 1);

    this.glow.alpha = 0.12;
    this.curveFill.clear();
    this.curveLine.clear();
    this.curveHighlight.clear();
    this.plane.visible = true;
    this.plane.alpha = 0.78;
    this.plane.position.set(Math.max(76, width * 0.08), height - Math.max(24, height * 0.04));
    this.plane.rotation = -0.03 + Math.sin(this.elapsedAnimation / 600) * 0.012;
    this.plane.scale.set(this.getPlaneScale(width, height) * 0.82);
    this.spinPropeller(1.3);

    this.statusText.visible = false;
    this.multiplierText.visible = false;
    this.waitingText.visible = true;
    this.waitingText.text = `NEXT ROUND IN ${seconds}s`;
    this.waitingText.position.set(width * 0.5, height * 0.46);
    this.waitingText.style.fontSize = clamp(height * 0.055, 18, 27);

    const barWidth = clamp(width * 0.34, 180, 420);
    const barHeight = 8;
    const barX = (width - barWidth) / 2;
    const barY = height * 0.54;
    this.waitingBar.visible = true;
    this.waitingBar.clear();
    this.waitingBar.roundRect(barX, barY, barWidth, barHeight, barHeight / 2).fill({ color: 0x26282c, alpha: 1 });
    this.waitingBar.roundRect(barX, barY, barWidth * progress, barHeight, barHeight / 2).fill({ color: 0xff0048, alpha: 1 });

    this.audience.visible = true;
  }

  private renderRunning(width: number, height: number, now: number): void {
    const elapsed = this.round.startedAt ? Math.max(0, now - this.round.startedAt) : 0;
    const liveMultiplier = Math.max(
      this.round.multiplier,
      this.round.startedAt ? Math.exp(elapsed * FLIGHT_CURVE_RATE) : this.round.multiplier
    );
    const visualMultiplier = Number(Math.max(1, liveMultiplier).toFixed(2));
    const flightPoint = this.calculateFlightPoint(width, height, elapsed);
    this.lastFlightPoint = flightPoint;

    this.drawFlightCurve(width, height, flightPoint);
    this.glow.alpha = clamp(0.28 + flightPoint.progress * 0.42, 0.28, 0.7);

    this.plane.visible = true;
    this.plane.alpha = 1;
    this.plane.position.set(
      flightPoint.x,
      flightPoint.y + Math.sin(this.elapsedAnimation / 230) * Math.max(1.5, height * 0.006)
    );
    this.plane.rotation = -0.055 + flightPoint.progress * -0.04 + Math.sin(this.elapsedAnimation / 420) * 0.012;
    this.plane.scale.set(this.getPlaneScale(width, height));
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
      this.plane.position.set(
        this.lastFlightPoint.x + width * 0.5 * eased,
        this.lastFlightPoint.y - height * 0.6 * eased
      );
      this.plane.rotation = -0.1 - eased * 0.24;
      this.plane.scale.set(this.getPlaneScale(width, height) * (1 + eased * 0.12));
      this.spinPropeller(3.4);
    } else {
      this.plane.visible = false;
    }

    this.waitingText.visible = false;
    this.waitingBar.visible = false;
    this.statusText.visible = true;
    this.statusText.text = "FLEW AWAY!";
    this.statusText.style.fontSize = clamp(height * 0.085, 28, 48);
    this.statusText.position.set(width * 0.5, height * 0.34);

    this.multiplierText.visible = true;
    this.multiplierText.text = `${this.round.multiplier.toFixed(2)}x`;
    this.multiplierText.style.fill = 0xe40027;
    this.multiplierText.position.set(width * 0.5, height * 0.51);
    this.multiplierText.alpha = clamp(crashElapsed / 180, 0, 1);
    this.audience.visible = true;
  }

  private drawStaticScene(width: number, height: number): void {
    this.background.clear();
    this.background.roundRect(0, 0, width, height, 24).fill(0x030406);

    this.rays.clear();
    const originX = 0;
    const originY = height;
    const radius = Math.hypot(width, height) * 1.75;
    const rayCount = 18;
    const startAngle = -Math.PI / 2 - 0.04;
    const endAngle = -0.015;
    const step = (endAngle - startAngle) / rayCount;

    for (let index = 0; index < rayCount; index += 1) {
      const angleA = startAngle + index * step;
      const angleB = angleA + step;
      const isBlue = index % 2 === 0;
      const color = isBlue ? 0x0a1821 : 0x000000;
      const alpha = isBlue ? 0.92 : 1;

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

    this.rays.pivot.set(0, height);
    this.rays.position.set(0, height);
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

  private calculateFlightPoint(width: number, height: number, elapsed: number): FlightPoint {
    const progress = clamp(Math.pow(Math.max(elapsed, 50) / 9000, 0.6), 0.026, 0.94);
    const startX = Math.max(26, width * 0.025);
    const baseY = height - Math.max(2, height * 0.008);
    const x = startX + progress * width * 0.83;
    const y = baseY - Math.pow(progress, 1.88) * height * 0.72;
    return { x, y, progress };
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
    const pillWidth = 112;
    const pillHeight = 38;
    this.audience.position.set(width - pillWidth - 9, height - pillHeight - 8);
    this.audienceBackground.clear();
    this.audienceBackground
      .roundRect(0, 0, pillWidth, pillHeight, pillHeight / 2)
      .fill({ color: 0x111315, alpha: 0.94 })
      .stroke({ color: 0x1e2226, width: 1 });
    this.audienceText.position.set(76, 10);
    this.audienceText.text = String(Math.max(0, this.round.online));
  }
}
