import type { DrawContext } from '../../src/render/draw-context';

export interface Call {
  readonly name: string;
  readonly args: readonly unknown[];
  /** Style state at the time of the call. */
  readonly alpha: number;
}

/** A DrawContext that records every drawing call, so renderers can be tested without a canvas. */
export function createRecordingContext(): { ctx: DrawContext; calls: Call[] } {
  const calls: Call[] = [];
  const state = {
    fillStyle: '' as DrawContext['fillStyle'],
    strokeStyle: '' as DrawContext['strokeStyle'],
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    textAlign: 'start' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
  };
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push({ name, args, alpha: state.globalAlpha });
    };
  const ctx = new Proxy(state as unknown as DrawContext, {
    get(_target, prop: string) {
      if (prop in state) return (state as Record<string, unknown>)[prop];
      return record(prop);
    },
    set(_target, prop: string, value) {
      (state as Record<string, unknown>)[prop] = value;
      calls.push({ name: `set:${prop}`, args: [value], alpha: state.globalAlpha });
      return true;
    },
  });
  return { ctx, calls };
}
