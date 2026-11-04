import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Single line that scrolls back and forth only when it doesn't fit. */
export function Marquee({ children, className = "" }: { children: ReactNode; className?: string }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);

  useLayoutEffect(() => {
    const o = outer.current, i = inner.current;
    if (!o || !i) return;
    const measure = () => setOverflow(Math.max(0, i.scrollWidth - o.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(o);
    return () => ro.disconnect();
  }, [children]);

  return (
    <div
      ref={outer}
      className={`overflow-hidden whitespace-nowrap ${className}`}
      style={overflow ? { maskImage: "linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent)" } : undefined}
    >
      <span
        ref={inner}
        className={`inline-block ${overflow ? "isle-marquee" : ""}`}
        style={overflow ? ({ "--marquee-shift": `-${overflow + 12}px`, "--marquee-dur": `${4 + overflow / 25}s`, paddingInline: 6 } as React.CSSProperties) : undefined}
      >
        {children}
      </span>
    </div>
  );
}
