import { useEffect, useRef, useState } from "react";
import type { RoundSnapshot } from "../types";
import { AviatorPixiScene } from "./pixi/AviatorPixiScene";

type Props = { round: RoundSnapshot; now: number };

export function GameGraph({ round }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<AviatorPixiScene | null>(null);
  const latestRoundRef = useRef(round);
  const [loadError, setLoadError] = useState("");

  latestRoundRef.current = round;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let scene: AviatorPixiScene | null = null;

    const start = async () => {
      try {
        scene = new AviatorPixiScene(host, latestRoundRef.current);
        await scene.init();

        if (cancelled) {
          scene.destroy();
          return;
        }

        sceneRef.current = scene;
        scene.setRound(latestRoundRef.current);
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "Unable to initialize the PixiJS renderer.";
          setLoadError(message);
        }
      }
    };

    void start();

    return () => {
      cancelled = true;
      sceneRef.current = null;
      scene?.destroy();
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setRound(round);
  }, [round]);

  return (
    <section className="game-graph pixi-game-graph">
      <div ref={hostRef} className="pixi-game-host" />
      {loadError && <div className="pixi-game-error">{loadError}</div>}
    </section>
  );
}
