import type { RoundSnapshot } from "../types";
import { Plane } from "./Plane";

type Props = { round: RoundSnapshot; now: number };

const FLIGHT_CURVE_RATE = 0.00006;

export function GameGraph({ round, now }: Props) {
  const waitingSeconds = round.phase === "WAITING" && round.phaseEndsAt
    ? Math.max(0, Math.ceil((round.phaseEndsAt - now) / 1000))
    : 0;

  const liveMultiplier = round.phase === "RUNNING" && round.startedAt
    ? Math.exp((now - round.startedAt) * FLIGHT_CURVE_RATE)
    : round.multiplier;

  const visualMultiplier = round.phase === "CRASHED"
    ? round.multiplier
    : Number(Math.max(1, liveMultiplier).toFixed(2));

  const progress = round.phase === "RUNNING"
    ? Math.min(1, Math.max(0.035, Math.log(Math.max(1, visualMultiplier)) / Math.log(14)))
    : round.phase === "CRASHED"
      ? 1
      : 0.04;

  const x = 6 + progress * 86;
  const y = 90 - Math.pow(progress, 1.8) * 72;
  const guideY = Math.min(89.4, y + 7);

  const curvePath = `M 4 92 C 20 91, ${Math.max(32, x - 28)} ${Math.max(78, guideY + 20)}, ${x} ${y}`;
  const horizonPath = `M 4 92 C 22 92, ${Math.max(28, x - 24)} ${Math.max(83, guideY + 12)}, ${x} ${Math.min(92, y + 10)}`;

  return (
    <section className={`game-graph phase-${round.phase.toLowerCase()}`}>
      <div className="rays" />
      <div className="graph-glow" />
      <div className="cloud cloud-a" />
      <div className="cloud cloud-b" />
      <div className="cloud cloud-c" />

      <svg className="curve" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="graphFillGradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(255, 23, 77, .48)" />
            <stop offset="60%" stopColor="rgba(255, 23, 77, .22)" />
            <stop offset="100%" stopColor="rgba(255, 23, 77, .04)" />
          </linearGradient>
          <linearGradient id="graphStrokeGradient" x1="0" x2="1" y1="1" y2="0">
            <stop offset="0%" stopColor="#ff2259" />
            <stop offset="45%" stopColor="#ff355f" />
            <stop offset="100%" stopColor="#ff5c81" />
          </linearGradient>
          <filter id="curveGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="1.8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <path className="graph-horizon" d={horizonPath} />
        <path d={`${curvePath} L ${x} 95 L 4 95 Z`} fill="url(#graphFillGradient)" />
        <path className="curve-trace" d={curvePath} />
        <path className="curve-main" d={curvePath} stroke="url(#graphStrokeGradient)" filter="url(#curveGlow)" />
      </svg>

      <div className="plane-position" style={{ left: `${x}%`, top: `${y}%` }}>
        <Plane />
      </div>

      <div className="multiplier-block">
        {round.phase === "WAITING" && <><small>Next flight in</small><strong>{waitingSeconds}s</strong></>}
        {round.phase === "RUNNING" && <strong>{visualMultiplier.toFixed(2)}x</strong>}
        {round.phase === "CRASHED" && <><strong>{round.multiplier.toFixed(2)}x</strong><small>Flew away</small></>}
      </div>
      <div className="fair-pill" title={round.commit}>Round #{round.roundId.slice(0, 8)} · Fair hash locked</div>
    </section>
  );
}
