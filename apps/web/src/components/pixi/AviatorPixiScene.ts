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

    this.plane = this.createPlane();

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
    this.background.rect(0, 0, width, height).fill(0x050607);

    this.rays.clear();
    const originX = 0;
    const originY = height;
    const radius = Math.hypot(width, height) * 1.45;
    const rayCount = 17;
    const startAngle = -Math.PI / 2;
    const endAngle = -0.035;
    const step = (endAngle - startAngle) / rayCount;

    for (let index = 0; index < rayCount; index += 1) {
      const angleA = startAngle + index * step;
      const angleB = angleA + step;
      const color = index % 2 === 0 ? 0x111416 : 0x000000;
      this.rays
        .poly([
          originX,
          originY,
          originX + Math.cos(angleA) * radius,
          originY + Math.sin(angleA) * radius,
          originX + Math.cos(angleB) * radius,
          originY + Math.sin(angleB) * radius
        ], true)
        .fill({ color, alpha: index % 2 === 0 ? 0.94 : 1 });
    }

    this.glow.clear();
    const glowX = width * 0.53;
    const glowY = height * 0.49;
    const glowWidth = width * 0.78;
    const glowHeight = height * 0.82;
    for (let index = 7; index >= 1; index -= 1) {
      const ratio = index / 7;
      this.glow
        .ellipse(glowX, glowY, glowWidth * ratio * 0.5, glowHeight * ratio * 0.5)
        .fill({ color: 0x087fbd, alpha: 0.018 + (1 - ratio) * 0.026 });
    }
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

  private createPlane(): any {
    const { Container, Graphics } = this.PIXI;
    const plane = new Container();

    const red = 0xf5004b;
    const redDark = 0xd4003f;
    const cut = 0x050607;

    const body = new Graphics();
    body
      .moveTo(58, 141)
      .lineTo(98, 118)
      .lineTo(108, 103)
      .lineTo(134, 92)
      .lineTo(173, 81)
      .lineTo(214, 70)
      .lineTo(252, 59)
      .lineTo(301, 44)
      .lineTo(338, 32)
      .lineTo(363, 30)
      .lineTo(377, 35)
      .lineTo(385, 49)
      .lineTo(387, 65)
      .lineTo(379, 78)
      .lineTo(351, 96)
      .lineTo(313, 114)
      .lineTo(264, 134)
      .lineTo(220, 149)
      .lineTo(166, 165)
      .lineTo(120, 178)
      .lineTo(98, 184)
      .lineTo(86, 179)
      .lineTo(74, 162)
      .lineTo(62, 148)
      .closePath()
      .fill(red);

    const wingUpper = new Graphics();
    wingUpper
      .poly([
        120, 104,
        162, 89,
        204, 78,
        241, 71,
        282, 70,
        292, 74,
        290, 82,
        267, 89,
        224, 94,
        177, 100,
        138, 111,
        124, 116
      ], true)
      .fill(red);

    const wingLower = new Graphics();
    wingLower
      .poly([
        111, 132,
        163, 115,
        210, 104,
        257, 100,
        286, 102,
        297, 108,
        292, 116,
        258, 129,
        211, 145,
        173, 158,
        145, 169,
        126, 167,
        115, 151
      ], true)
      .fill(red);

    const cockpit = new Graphics();
    cockpit
      .poly([
        189, 70,
        244, 43,
        291, 31,
        338, 29,
        347, 34,
        359, 72,
        313, 85,
        252, 79,
        198, 77
      ], true)
      .fill(red);

    const roof = new Graphics();
    roof
      .poly([
        214, 57,
        235, 45,
        259, 42,
        249, 52,
        230, 60,
        216, 60
      ], true)
      .fill(red);

    const tailTop = new Graphics();
    tailTop
      .poly([
        73, 161,
        49, 144,
        36, 148,
        56, 168,
        72, 183,
        78, 180
      ], true)
      .fill(red);

    const tailBottom = new Graphics();
    tailBottom
      .poly([
        82, 176,
        47, 189,
        56, 197,
        90, 186,
        110, 199,
        103, 205,
        86, 195
      ], true)
      .fill(redDark);

    const rearHook = new Graphics();
    rearHook
      .poly([
        95, 193,
        109, 206,
        101, 211,
        88, 198
      ], true)
      .fill(red);

    const skid = new Graphics();
    skid
      .moveTo(99, 194)
      .bezierCurveTo(153, 188, 215, 173, 274, 151)
      .bezierCurveTo(316, 136, 351, 118, 387, 96)
      .lineTo(396, 103)
      .bezierCurveTo(365, 124, 326, 144, 276, 163)
      .bezierCurveTo(215, 186, 155, 202, 112, 206)
      .lineTo(99, 194)
      .closePath()
      .fill(red);

    const noseFin = new Graphics();
    noseFin
      .poly([
        373, 60,
        395, 58,
        404, 59,
        391, 73,
        379, 79,
        370, 71
      ], true)
      .fill(red);

    this.propeller = new Graphics();
    this.propeller.ellipse(0, -34, 10, 41).fill(red);
    this.propeller.ellipse(0, 34, 10, 41).fill(red);
    this.propeller.circle(0, 0, 6).fill(redDark);
    this.propeller.position.set(404, 49);

    const cockpitCut = new Graphics();
    cockpitCut
      .poly([
        208, 70,
        252, 48,
        332, 35,
        343, 70,
        303, 79,
        253, 75
      ], true)
      .fill(cut);

    const innerCabin = new Graphics();
    innerCabin
      .poly([
        259, 68,
        286, 52,
        306, 49,
        317, 68,
        294, 78,
        270, 75
      ], true)
      .fill(red);

    const backWindowCut = new Graphics();
    backWindowCut
      .poly([
        204, 66,
        227, 55,
        241, 58,
        223, 71
      ], true)
      .fill(cut);

    const roofCut = new Graphics();
    roofCut
      .poly([
        227, 56,
        239, 49,
        252, 49,
        242, 57,
        232, 60
      ], true)
      .fill(cut);

    const xMarkA = new Graphics();
    xMarkA
      .moveTo(297, 52)
      .lineTo(304, 52)
      .lineTo(313, 66)
      .lineTo(321, 46)
      .lineTo(327, 47)
      .lineTo(316, 69)
      .lineTo(326, 84)
      .lineTo(319, 84)
      .lineTo(310, 71)
      .lineTo(302, 84)
      .lineTo(295, 84)
      .lineTo(306, 67)
      .closePath()
      .fill(red);

    const wingCutTop = new Graphics();
    wingCutTop
      .poly([
        130, 108,
        179, 101,
        223, 97,
        253, 96,
        268, 98,
        273, 102,
        265, 107,
        228, 110,
        183, 114,
        144, 121,
        135, 119
      ], true)
      .fill(cut);

    const wingCutBottom = new Graphics();
    wingCutBottom
      .poly([
        121, 143,
        169, 129,
        213, 121,
        247, 119,
        266, 122,
        251, 132,
        208, 147,
        170, 161,
        143, 168,
        133, 162
      ], true)
      .fill(cut);

    const bellyCut = new Graphics();
    bellyCut
      .moveTo(118, 191)
      .bezierCurveTo(163, 183, 215, 168, 268, 149)
      .bezierCurveTo(313, 133, 345, 116, 372, 99)
      .lineTo(379, 104)
      .bezierCurveTo(348, 124, 313, 142, 269, 158)
      .bezierCurveTo(222, 175, 168, 190, 127, 197)
      .lineTo(118, 191)
      .closePath()
      .fill(cut);

    const tailCutTop = new Graphics();
    tailCutTop
      .poly([
        58, 160,
        47, 151,
        53, 149,
        64, 158,
        72, 169,
        69, 172
      ], true)
      .fill(cut);

    const tailCutBottom = new Graphics();
    tailCutBottom
      .poly([
        77, 187,
        53, 195,
        59, 198,
        84, 190,
        96, 198,
        92, 201
      ], true)
      .fill(cut);

    const cutStroke = new Graphics();
    cutStroke
      .moveTo(138, 123)
      .lineTo(120, 131)
      .moveTo(129, 166)
      .lineTo(111, 176)
      .stroke({ color: cut, width: 5, cap: "round", join: "round" });

    plane.addChild(
      body,
      tailTop,
      tailBottom,
      rearHook,
      skid,
      wingUpper,
      wingLower,
      cockpit,
      roof,
      noseFin,
      cockpitCut,
      innerCabin,
      backWindowCut,
      roofCut,
      wingCutTop,
      wingCutBottom,
      bellyCut,
      tailCutTop,
      tailCutBottom,
      cutStroke,
      xMarkA,
      this.propeller
    );

    plane.pivot.set(225, 110);
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
