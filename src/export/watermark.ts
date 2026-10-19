/** The mark a Free export carries in its bottom-right corner. Pro exports are clean. */
export const WATERMARK_TEXT = 'Made with Tab Highway';

/** The parts of a canvas 2D context the mark needs, so tests can pass a recording fake. */
export interface MarkContext {
  font: string;
  fillStyle: string | CanvasGradient | CanvasPattern;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  globalAlpha: number;
  save(): void;
  restore(): void;
  measureText(text: string): { width: number };
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
}

export interface MarkLayout {
  readonly fontPx: number;
  /** The pill behind the text: left, top, width, height. */
  readonly pill: { x: number; y: number; w: number; h: number };
  /** Where the text is drawn (right-aligned, vertically centred). */
  readonly textX: number;
  readonly textY: number;
}

/** Where the mark goes in a frame of this size. It scales with the frame height and always sits fully inside. */
export function markLayout(width: number, height: number, textWidthAtOnePx: number): MarkLayout {
  const fontPx = Math.max(14, Math.round(height * 0.028));
  const pad = Math.round(fontPx * 0.6);
  const margin = Math.round(fontPx * 0.9);
  const textWidth = textWidthAtOnePx * fontPx;
  const w = Math.min(width - 2 * margin, Math.ceil(textWidth + 2 * pad));
  const h = Math.ceil(fontPx + 2 * pad);
  const x = width - margin - w;
  const y = height - margin - h;
  return { fontPx, pill: { x, y, w, h }, textX: x + w - pad, textY: y + h / 2 };
}

/** Draws the mark over a finished frame. */
export function drawWatermark(ctx: MarkContext, width: number, height: number): void {
  ctx.save();
  const probePx = 100;
  ctx.font = `600 ${probePx}px sans-serif`;
  const layout = markLayout(width, height, ctx.measureText(WATERMARK_TEXT).width / probePx);
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = '#000000';
  ctx.fillRect(layout.pill.x, layout.pill.y, layout.pill.w, layout.pill.h);
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = '#ffffff';
  ctx.font = `600 ${layout.fontPx}px sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(WATERMARK_TEXT, layout.textX, layout.textY);
  ctx.restore();
}
