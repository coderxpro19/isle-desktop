import type { Spectrum } from "./types";

/**
 * Spectrum frames arrive ~30x/s. They bypass React state entirely: the
 * visualiser subscribes here and writes bar transforms straight to the DOM,
 * so the rest of the island never re-renders because of audio.
 */
type Sub = (s: Spectrum) => void;
const subs = new Set<Sub>();
let last: Spectrum = new Array(12).fill(0);

export const spectrumBus = {
  push(s: Spectrum) {
    last = s;
    subs.forEach((f) => f(s));
  },
  subscribe(f: Sub): () => void {
    subs.add(f);
    f(last);
    return () => subs.delete(f);
  },
};
