import { labelBoxWidth } from '../../src/render/strip-marks';
import { GUTTER_WIDTH } from '../../src/render/tab-strip';
import type { NoteSpec } from '../helpers/make-timeline';
import type { Call } from '../helpers/recording-context';

const STEP = 0.125;

/** Two bars shaped like bars 113 to 118 of the example song: sixteenth runs with bends, palm mutes, a harmonic and chords. */
export function busyPassage(): NoteSpec[] {
  const run = (bar: number, from: number, frets: number[], techniques?: NoteSpec['techniques'], string = 2): NoteSpec[] =>
    frets.map((fret, i) => {
      const start = bar * 2 + (from + i) * STEP;
      return { start, end: start + STEP, string, fret, techniques };
    });
  return [
    // bar 1: a bend straight into a palm-muted run, a harmonic beside a half bend, then plain notes
    ...run(0, 0, [12, 10], undefined),
    ...run(0, 2, [12], { bend: 2 }),
    ...run(0, 3, [10, 12, 10, 12], { palmMute: true }),
    ...run(0, 7, [13], { harmonic: true }),
    ...run(0, 8, [15], { bend: 1 }),
    ...run(0, 9, [13, 10, 12, 10, 12, 10, 12], undefined),
    // bar 2: chord stacks with a bend on the lowest string of each chord
    ...[0, 2, 4, 6, 8, 10, 12, 14].flatMap((slot) => [
      ...run(1, slot, [15], undefined, 1),
      ...run(1, slot, [15], undefined, 2),
      ...run(1, slot, [13], slot % 4 === 0 ? { bend: 2 } : undefined, 3),
    ]),
  ];
}

export interface Box {
  readonly text: string;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/**
 * The boxes of the bold text a strip draws (fret numbers and marks), rebuilt from recorded calls. The recording context
 * cannot measure text, so widths use the same estimate the layout does. Bar numbers and the clef gutter are not bold
 * or sit left of the gutter edge, and are left out.
 */
export function textBoxes(calls: readonly Call[]): Box[] {
  let font = '';
  let align = 'start';
  let baseline = 'alphabetic';
  const boxes: Box[] = [];
  for (const c of calls) {
    if (c.name === 'set:font') font = String(c.args[0]);
    else if (c.name === 'set:textAlign') align = String(c.args[0]);
    else if (c.name === 'set:textBaseline') baseline = String(c.args[0]);
    else if (c.name === 'fillText') {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 0);
      const [text, x, y] = [String(c.args[0]), Number(c.args[1]), Number(c.args[2])];
      if (!font.startsWith('bold') || x < GUTTER_WIDTH) continue;
      const w = labelBoxWidth(text, size);
      const left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
      const top = baseline === 'middle' ? y - size / 2 : baseline === 'bottom' ? y - size : y;
      boxes.push({ text, left, right: left + w, top, bottom: top + size });
    }
  }
  return boxes;
}

/** Every pair of boxes that share any area. */
export function overlaps(boxes: readonly Box[]): [Box, Box][] {
  const found: [Box, Box][] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) found.push([a, b]);
    }
  }
  return found;
}
