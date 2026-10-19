/** The frame's main video: the largest one on screen, a playing one first. */
export function mainVideo(): HTMLVideoElement | null {
  let best: HTMLVideoElement | null = null;
  let bestScore = 0;
  for (const v of Array.from(document.querySelectorAll('video'))) {
    const r = v.getBoundingClientRect();
    const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    const area = w * h;
    if (area < 120 * 70) continue;
    const score = area * (v.paused ? 1 : 4);
    if (score > bestScore) { best = v; bestScore = score; }
  }
  return best;
}

export function visibleArea(v: HTMLVideoElement | null): number {
  if (!v) return 0;
  const r = v.getBoundingClientRect();
  return Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) * (v.paused ? 1 : 4);
}
