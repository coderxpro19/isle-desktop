/**
 * Pick a vivid accent colour from an image, tuned to read well on the black
 * island: we weight pixels by saturation, then clamp lightness.
 */
export async function extractAccent(src: string): Promise<string | null> {
  const img = new Image();
  img.decoding = "async";
  img.src = src;
  try {
    await img.decode();
  } catch {
    return null;
  }
  const size = 20;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);

  let r = 0, g = 0, b = 0, total = 0;
  for (let i = 0; i < data.length; i += 4) {
    const [pr, pg, pb] = [data[i]!, data[i + 1]!, data[i + 2]!];
    const max = Math.max(pr, pg, pb), min = Math.min(pr, pg, pb);
    const sat = max === 0 ? 0 : (max - min) / max;
    const w = 0.05 + sat * sat * (max / 255);
    r += pr * w; g += pg * w; b += pb * w; total += w;
  }
  if (!total) return null;
  const [h, s, l] = rgbToHsl(r / total, g / total, b / total);
  return `hsl(${Math.round(h)} ${Math.round(Math.max(s, 45))}% ${Math.round(Math.min(Math.max(l, 58), 72))}%)`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}
