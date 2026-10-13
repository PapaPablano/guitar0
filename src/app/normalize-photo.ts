import type { NormalizeSpec } from '../render/neck-calibration';

/** The longest side a stored photo keeps, in pixels; a bigger one is stored smaller. */
export const MAX_LONG_SIDE = 2048;

/** The size of the turned photo, and how much smaller than the original's pixels it is drawn so it fits the cap. */
export function normalizedSize(spec: NormalizeSpec, maxLong: number = MAX_LONG_SIDE): { width: number; height: number; scale: number } {
  const scale = Math.min(1, maxLong / Math.max(spec.width, spec.height));
  return { width: Math.max(1, Math.round(spec.width * scale)), height: Math.max(1, Math.round(spec.height * scale)), scale };
}

/** The canvas transform `[a, b, c, d, e, f]` that draws the original photo turned and cut as `spec` says, at `scale`. */
export function normalizeTransform(spec: NormalizeSpec, scale: number): [number, number, number, number, number, number] {
  const cos = Math.cos(spec.angle);
  const sin = Math.sin(spec.angle);
  const { x: cx, y: cy } = spec.centre;
  return [
    cos * scale,
    sin * scale,
    -sin * scale,
    cos * scale,
    scale * (-(cos * cx - sin * cy) - spec.minX),
    scale * (-(sin * cx + cos * cy) - spec.minY),
  ];
}

/** The photo turned so the neck runs left to right with the headstock on the left, as a canvas the neck view draws and the store keeps. */
export function normalizePhoto(image: CanvasImageSource, spec: NormalizeSpec): HTMLCanvasElement {
  const { width, height, scale } = normalizedSize(spec);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('The photo could not be prepared.');
  ctx.setTransform(...normalizeTransform(spec, scale));
  ctx.drawImage(image, 0, 0);
  return canvas;
}
