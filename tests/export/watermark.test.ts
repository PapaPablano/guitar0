import { describe, expect, it } from 'vitest';
import { drawWatermark, markLayout, WATERMARK_TEXT, type MarkContext } from '../../src/export/watermark';
import { PRESETS } from '../../src/export/presets';

/** A context that records what is drawn, measuring text as half a pixel-height per character like a typical sans font. */
function recorder(): MarkContext & { calls: string[]; texts: { text: string; x: number; y: number; font: string }[]; rects: number[][] } {
  const calls: string[] = [];
  const texts: { text: string; x: number; y: number; font: string }[] = [];
  const rects: number[][] = [];
  const ctx = {
    font: '',
    fillStyle: '',
    textAlign: 'left' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    globalAlpha: 1,
    calls,
    texts,
    rects,
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    measureText: (text: string) => {
      const px = Number(/(\d+)px/.exec(ctx.font)?.[1] ?? 0);
      return { width: text.length * px * 0.5 };
    },
    fillRect: (x: number, y: number, w: number, h: number) => rects.push([x, y, w, h]),
    fillText: (text: string, x: number, y: number) => texts.push({ text, x, y, font: ctx.font }),
  };
  return ctx;
}

describe('watermark', () => {
  it('Covers AE3. draws the mark text once, inside the frame, between a save and a restore', () => {
    const ctx = recorder();
    drawWatermark(ctx, 1920, 1080);
    expect(ctx.texts).toHaveLength(1);
    expect(ctx.texts[0].text).toBe(WATERMARK_TEXT);
    expect(ctx.calls).toEqual(['save', 'restore']);
    const [x, y, w, h] = ctx.rects[0];
    expect(x).toBeGreaterThan(0);
    expect(y).toBeGreaterThan(0);
    expect(x + w).toBeLessThanOrEqual(1920);
    expect(y + h).toBeLessThanOrEqual(1080);
  });

  it('sits in the bottom-right corner and scales with the frame for every export preset', () => {
    for (const preset of PRESETS) {
      const ctx = recorder();
      drawWatermark(ctx, preset.width, preset.height);
      const [x, y, w, h] = ctx.rects[0];
      expect(x + w / 2).toBeGreaterThan(preset.width / 2);
      expect(y + h / 2).toBeGreaterThan(preset.height / 2);
      expect(x + w).toBeLessThanOrEqual(preset.width);
      expect(y + h).toBeLessThanOrEqual(preset.height);
      expect(ctx.texts[0].x).toBeLessThanOrEqual(x + w);
    }
  });

  it('keeps the mark inside a narrow frame by capping its width', () => {
    const layout = markLayout(300, 600, 12);
    expect(layout.pill.x).toBeGreaterThanOrEqual(0);
    expect(layout.pill.x + layout.pill.w).toBeLessThanOrEqual(300);
  });

  it('leaves the context as it found it: the drawing state is restored', () => {
    const ctx = recorder();
    drawWatermark(ctx, 1280, 720);
    expect(ctx.calls[0]).toBe('save');
    expect(ctx.calls[ctx.calls.length - 1]).toBe('restore');
  });
});
