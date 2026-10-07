/**
 * The slice of the canvas 2D API the renderers use. CanvasRenderingContext2D and
 * OffscreenCanvasRenderingContext2D both satisfy it, and tests pass a recording fake.
 */
export interface DrawContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  globalAlpha: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  save(): void;
  restore(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  ellipse(x: number, y: number, rx: number, ry: number, rotation: number, start: number, end: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  fill(): void;
  stroke(): void;
  fillText(text: string, x: number, y: number): void;
  setLineDash(segments: number[]): void;
}
