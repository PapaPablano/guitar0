import type { DrawContext } from './draw-context';

/** Where the strikeline sits in a waterfall column, as a fraction of the column's height up from the bottom. */
export const WATERFALL_STRIKE_FRACTION = 0.25;

/** A drawing context that can also move its origin and turn, which the frame and page contexts already do. */
export interface TurnHost extends DrawContext {
  translate(x: number, y: number): void;
  rotate(angle: number): void;
}

/** What a renderer draws into when its landscape drawing is laid onto a column. */
export interface TurnedContext extends DrawContext {
  /** When true, text is drawn turned with the strip instead of upright. Technique-mark labels set this, since the mark planner measures them along the time axis. */
  textTurned: boolean;
}

export interface Column {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

const QUARTER_TURN = Math.PI / 2;

/**
 * Lays a landscape drawing onto a column turned a quarter turn counter-clockwise: the drawing's x axis (time, past at 0)
 * runs up from the column's bottom edge and its y axis runs left to right. `draw` gets a canvas as wide as the column
 * is tall and as tall as the column is wide. Text comes out upright unless `textTurned` is set.
 * The caller clips to the column; this only moves and turns the origin, and puts it back.
 */
export function drawTurned(host: TurnHost, column: Column, draw: (ctx: TurnedContext, width: number, height: number) => void): void {
  host.save();
  host.translate(column.left, column.top + column.height);
  host.rotate(-QUARTER_TURN);

  let textTurned = false;
  const fillText = (text: string, x: number, y: number): void => {
    if (textTurned) {
      host.fillText(text, x, y);
      return;
    }
    host.save();
    host.translate(x, y);
    host.rotate(QUARTER_TURN);
    host.fillText(text, 0, 0);
    host.restore();
  };

  const turned = new Proxy(host as unknown as TurnedContext, {
    has(_target, prop) {
      return prop === 'textTurned' || prop in host;
    },
    get(_target, prop: string) {
      if (prop === 'textTurned') return textTurned;
      if (prop === 'fillText') return fillText;
      const value = (host as unknown as Record<string, unknown>)[prop];
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(host) : value;
    },
    set(_target, prop: string, value) {
      if (prop === 'textTurned') textTurned = Boolean(value);
      else (host as unknown as Record<string, unknown>)[prop] = value;
      return true;
    },
  });

  draw(turned, column.height, column.width);
  host.restore();
}
