import { describe, expect, it } from 'vitest';
import { drawTurned, WATERFALL_STRIKE_FRACTION, type TurnHost } from '../../src/render/upright';
import { createRecordingContext, type Call } from '../helpers/recording-context';

const COLUMN = { left: 100, top: 50, width: 300, height: 800 };
const names = (calls: Call[]) => calls.map((c) => c.name);

function host() {
  const { ctx, calls } = createRecordingContext();
  return { host: ctx as unknown as TurnHost, calls };
}

describe('drawTurned', () => {
  it('turns the context a quarter turn counter-clockwise about the bottom-left of the column', () => {
    const { host: h, calls } = host();
    drawTurned(h, COLUMN, (ctx) => {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(10, 0);
    });
    const translate = calls.find((c) => c.name === 'translate');
    const rotate = calls.find((c) => c.name === 'rotate');
    expect(translate?.args).toEqual([COLUMN.left, COLUMN.top + COLUMN.height]);
    expect(rotate?.args[0]).toBeCloseTo(-Math.PI / 2);
    expect(names(calls).indexOf('rotate')).toBeLessThan(names(calls).indexOf('lineTo'));
  });

  it('mirrors the drawing across the column so the top string is the rightmost lane', () => {
    const { host: h, calls } = host();
    drawTurned(h, COLUMN, (ctx) => ctx.lineTo(0, 0));
    const at = names(calls).indexOf('rotate');
    expect(calls[at + 1]).toMatchObject({ name: 'translate', args: [0, COLUMN.width] });
    expect(calls[at + 2]).toMatchObject({ name: 'scale', args: [1, -1] });
  });

  it('gives the callback a landscape canvas as wide as the column is tall', () => {
    const { host: h } = host();
    let size: [number, number] = [0, 0];
    drawTurned(h, COLUMN, (_ctx, width, height) => {
      size = [width, height];
    });
    expect(size).toEqual([COLUMN.height, COLUMN.width]);
  });

  it('scales the drawing and shrinks the canvas it is given by the same factor when zoomed', () => {
    const { host: h, calls } = host();
    let size: [number, number] = [0, 0];
    drawTurned(
      h,
      COLUMN,
      (_ctx, width, height) => {
        size = [width, height];
      },
      2,
    );
    expect(calls.find((c) => c.name === 'scale' && c.args[0] === 2)?.args).toEqual([2, 2]);
    expect(size).toEqual([COLUMN.height / 2, COLUMN.width / 2]);
    // no zoom scale at all when not zoomed
    const plain = host();
    drawTurned(plain.host, COLUMN, () => {});
    expect(plain.calls.some((c) => c.name === 'scale' && c.args[0] !== 1)).toBe(false);
  });

  it('draws text upright: save, translate to the anchor, undo the mirror, quarter turn clockwise, text at the origin, restore', () => {
    const { host: h, calls } = host();
    drawTurned(h, COLUMN, (ctx) => ctx.fillText('7', 40, 12));
    const at = names(calls).indexOf('fillText');
    expect(calls[at].args).toEqual(['7', 0, 0]);
    expect(calls[at - 4].name).toBe('save');
    expect(calls[at - 3]).toMatchObject({ name: 'translate', args: [40, 12] });
    expect(calls[at - 2]).toMatchObject({ name: 'scale', args: [1, -1] });
    expect(calls[at - 1].name).toBe('rotate');
    expect(calls[at - 1].args[0]).toBeCloseTo(Math.PI / 2);
    expect(calls[at + 1].name).toBe('restore');
  });

  it('keeps the text turned with the strip but not mirrored, and counter-turns again afterwards', () => {
    const { host: h, calls } = host();
    drawTurned(h, COLUMN, (ctx) => {
      ctx.textTurned = true;
      ctx.fillText('H', 5, 6);
      ctx.textTurned = false;
      ctx.fillText('9', 7, 8);
    });
    const texts = calls.filter((c) => c.name === 'fillText');
    expect(texts[0].args).toEqual(['H', 0, 0]);
    const turnedAt = names(calls).indexOf('fillText');
    expect(calls[turnedAt - 2]).toMatchObject({ name: 'translate', args: [5, 6] });
    expect(calls[turnedAt - 1]).toMatchObject({ name: 'scale', args: [1, -1] });
    expect(calls.slice(turnedAt - 3, turnedAt).some((c) => c.name === 'rotate')).toBe(false);
    expect(texts[1].args).toEqual(['9', 0, 0]);
  });

  it('sets style properties on the host', () => {
    const { host: h, calls } = host();
    drawTurned(h, COLUMN, (ctx) => {
      ctx.fillStyle = '#abc';
      ctx.font = 'bold 12px x';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
    });
    const sets = calls.filter((c) => c.name.startsWith('set:')).map((c) => [c.name, c.args[0]]);
    expect(sets).toEqual([
      ['set:fillStyle', '#abc'],
      ['set:font', 'bold 12px x'],
      ['set:textAlign', 'center'],
      ['set:lineWidth', 3],
    ]);
  });

  it('leaves saves and restores balanced, whether or not the callback draws', () => {
    for (const draws of [true, false]) {
      const { host: h, calls } = host();
      drawTurned(h, COLUMN, (ctx) => {
        if (draws) {
          ctx.save();
          ctx.fillText('3', 1, 1);
          ctx.restore();
        }
      });
      const saves = calls.filter((c) => c.name === 'save').length;
      const restores = calls.filter((c) => c.name === 'restore').length;
      expect(saves).toBe(restores);
    }
  });
});

describe('WATERFALL_STRIKE_FRACTION', () => {
  it('puts the strikeline a quarter of the way up from the bottom', () => {
    expect(WATERFALL_STRIKE_FRACTION).toBe(0.25);
  });
});
