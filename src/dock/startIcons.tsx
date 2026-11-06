/** Start button icon presets (the user can also upload their own image). */
export const START_PRESETS: { id: string; label: string }[] = [
  { id: "isle", label: "Isle" },
  { id: "windows", label: "Windows" },
  { id: "flower", label: "Flower" },
  { id: "sun", label: "Sun" },
  { id: "grid", label: "Grid" },
];

export function StartGlyph({ icon, size }: { icon: string; size: number }) {
  if (icon.startsWith("data:image/")) {
    return <img src={icon} alt="" draggable={false} className="h-full w-full rounded-[24%] object-cover" style={{ width: size, height: size }} />;
  }
  switch (icon) {
    case "windows":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
          <defs>
            <linearGradient id="isle-win" x1="0" y1="0" x2="1" y2="1">
              <stop stopColor="#4cc2ff" />
              <stop offset="1" stopColor="#0a7fd9" />
            </linearGradient>
          </defs>
          <path d="M3 3h8.5v8.5H3zM12.5 3H21v8.5h-8.5zM3 12.5h8.5V21H3zM12.5 12.5H21V21h-8.5z" fill="url(#isle-win)" />
        </svg>
      );
    case "flower":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <ellipse key={a} cx="12" cy="6.2" rx="3" ry="4.4" fill="#f4f4f6" transform={`rotate(${a} 12 12)`} />
          ))}
          <circle cx="12" cy="12" r="3.4" fill="#ffc83d" />
        </svg>
      );
    case "sun":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
          {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((a) => (
            <path key={a} d="M12 1.5 13.6 5h-3.2Z" fill="#ffb21a" transform={`rotate(${a} 12 12)`} />
          ))}
          <circle cx="12" cy="12" r="6.4" fill="#ffc83d" />
          <circle cx="9.8" cy="11.3" r=".9" fill="#5a3b00" />
          <circle cx="14.2" cy="11.3" r=".9" fill="#5a3b00" />
          <path d="M9.6 13.8c1.4 1.4 3.4 1.4 4.8 0" stroke="#5a3b00" strokeWidth="1" fill="none" strokeLinecap="round" />
        </svg>
      );
    case "grid":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
          {[0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => <rect key={`${r}${c}`} x={3 + c * 6.5} y={3 + r * 6.5} width="5" height="5" rx="1.6" fill="#f4f4f6" />))}
        </svg>
      );
    default:
      return (
        <div className="grid place-items-center rounded-[24%] bg-gradient-to-b from-[#3d4a8f] to-[#1d2147] shadow-inner" style={{ width: size, height: size }}>
          <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" aria-hidden>
            <rect x="3" y="7.5" width="18" height="7" rx="3.5" fill="#05060a" />
            <circle cx="7.3" cy="11" r="1.8" fill="#ffb15a" />
            <path d="M13.5 11h0M16 9.6v2.8M18.4 10.3v1.4" stroke="#9db4ff" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </div>
      );
  }
}

/** Shrink a picked image to a 96px PNG data URL (keeps settings small). */
export async function iconFromFile(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = c.height = 96;
    const ctx = c.getContext("2d")!;
    const s = Math.min(img.width, img.height);
    ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 96, 96);
    return c.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}
