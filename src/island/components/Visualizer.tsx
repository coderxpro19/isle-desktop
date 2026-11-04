import { useEffect, useRef } from "react";
import { spectrumBus } from "@/lib/spectrum";

interface Props {
  /** Which of the 12 bands to show, left to right. */
  bands?: number[];
  height: number;
  barWidth?: number;
  gap?: number;
  color: string;
  playing: boolean;
}

const DEFAULT_BANDS = [1, 3, 5, 7, 9];

/**
 * Audio-reactive bars. Writes transforms directly to the DOM from the
 * spectrum bus — no React renders per frame, compositor-only animation.
 * When nothing is playing, bars settle to a gentle idle shape.
 */
export function Visualizer({ bands = DEFAULT_BANDS, height, barWidth = 3, gap = 2, color, playing }: Props) {
  const bars = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    if (!playing) {
      bars.current.forEach((el, i) => el && (el.style.transform = `scaleY(${0.18 + (i % 2) * 0.06})`));
      return;
    }
    return spectrumBus.subscribe((s) => {
      bands.forEach((b, i) => {
        const el = bars.current[i];
        if (el) el.style.transform = `scaleY(${0.14 + ((s[b] ?? 0) / 255) * 0.86})`;
      });
    });
  }, [bands, playing]);

  return (
    <div className="flex items-center" style={{ height, gap }} aria-hidden>
      {bands.map((b, i) => (
        <span
          key={b}
          ref={(el) => {
            bars.current[i] = el;
          }}
          className="block rounded-full will-change-transform"
          style={{
            width: barWidth,
            height,
            background: color,
            transform: "scaleY(0.2)",
            transition: "transform 90ms linear",
          }}
        />
      ))}
    </div>
  );
}
