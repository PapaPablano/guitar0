import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PanelId } from '../../src/app/stage-layout';
import { renderStageFrame, type FrameContext } from '../../src/render/stage-frame';
import { makeTimeline, type NoteSpec } from '../helpers/make-timeline';
import { createRecordingContext } from '../helpers/recording-context';

// Frames that the vertical waterfall work must leave alone. Each is hashed from the drawing calls it makes.
// The table was captured on the code as it stood before that work.

const specs: NoteSpec[] = [1, 2, 3, 4, 5, 6, 7].map((s, i) => ({
  start: s,
  end: s + 0.5,
  string: 1 + (i % 6),
  fret: 2 + i,
}));
const timeline = makeTimeline(specs, 2, 6);

const TIMES = [0.5, 1.1, 1.3, 3.0];
const LOOP = { startBar: 0, endBar: 1 };

function hashOf(width: number, height: number, panels: PanelId[], t: number, lookahead: number, loop = false): string {
  const { ctx, calls } = createRecordingContext();
  renderStageFrame(ctx as unknown as FrameContext, timeline, 0, t, width, height, panels, {
    lookahead,
    loop: loop ? LOOP : null,
    photo: null,
  });
  // FNV-1a over the recorded calls
  const text = JSON.stringify(calls);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const LANDSCAPE: PanelId[][] = [['highway', 'tab'], ['highway', 'neck'], ['tab', 'neck'], ['highway'], ['tab'], ['highway', 'fretboard']];
const PORTRAIT_STACKED: PanelId[][] = [['highway', 'fretboard'], ['neck'], ['highway', 'neck'], ['tab', 'neck'], ['neck', 'pick']];

function keysFor(width: number, height: number, layouts: PanelId[][]): { key: string; run: () => string }[] {
  const out: { key: string; run: () => string }[] = [];
  for (const panels of layouts) {
    for (const t of TIMES) {
      out.push({ key: `${width}x${height}:${panels.join('+')}@${t}`, run: () => hashOf(width, height, panels, t, 4) });
    }
    out.push({ key: `${width}x${height}:${panels.join('+')}@1.3:loop`, run: () => hashOf(width, height, panels, 1.3, 4, true) });
  }
  return out;
}

const CASES = [...keysFor(1920, 1080, LANDSCAPE), ...keysFor(1080, 1920, PORTRAIT_STACKED)];

const PINNED: Record<string, string> = {
  '1920x1080:highway+tab@0.5': '03604b85',
  '1920x1080:highway+tab@1.1': '4a8e96ae',
  '1920x1080:highway+tab@1.3': '594ccfcf',
  '1920x1080:highway+tab@3': '1f34d07f',
  '1920x1080:highway+tab@1.3:loop': 'd057f2fd',
  '1920x1080:highway+neck@0.5': '0545e694',
  '1920x1080:highway+neck@1.1': '2c4c6c7b',
  '1920x1080:highway+neck@1.3': '474b9203',
  '1920x1080:highway+neck@3': 'fb9f62f0',
  '1920x1080:highway+neck@1.3:loop': 'f2b03f00',
  '1920x1080:tab+neck@0.5': '68eafd04',
  '1920x1080:tab+neck@1.1': 'ff6f8cfb',
  '1920x1080:tab+neck@1.3': 'e2463008',
  '1920x1080:tab+neck@3': '2bfec106',
  '1920x1080:tab+neck@1.3:loop': '94935b1d',
  '1920x1080:highway@0.5': 'f7eb269c',
  '1920x1080:highway@1.1': '3c1448ac',
  '1920x1080:highway@1.3': '34653f51',
  '1920x1080:highway@3': '598ce5b3',
  '1920x1080:highway@1.3:loop': '08e3d94a',
  '1920x1080:tab@0.5': '750e2fc1',
  '1920x1080:tab@1.1': 'bd40efe6',
  '1920x1080:tab@1.3': '720659f5',
  '1920x1080:tab@3': 'a7bd2b7d',
  '1920x1080:tab@1.3:loop': '247fe0b3',
  '1920x1080:highway+fretboard@0.5': '324815ac',
  '1920x1080:highway+fretboard@1.1': '4fa97308',
  '1920x1080:highway+fretboard@1.3': '2bbee1bb',
  '1920x1080:highway+fretboard@3': '9a6a42db',
  '1920x1080:highway+fretboard@1.3:loop': 'ea14eb38',
  '1080x1920:highway+fretboard@0.5': 'b10fb04a',
  '1080x1920:highway+fretboard@1.1': '069f2664',
  '1080x1920:highway+fretboard@1.3': 'ce6809bf',
  '1080x1920:highway+fretboard@3': 'd938b047',
  '1080x1920:highway+fretboard@1.3:loop': 'da28e0ab',
  '1080x1920:neck@0.5': '723a0b13',
  '1080x1920:neck@1.1': 'e48aad6f',
  '1080x1920:neck@1.3': '46275ea7',
  '1080x1920:neck@3': 'f7fec579',
  '1080x1920:neck@1.3:loop': 'ae803d63',
  '1080x1920:highway+neck@0.5': '179b4dd4',
  '1080x1920:highway+neck@1.1': '083c9dcf',
  '1080x1920:highway+neck@1.3': '87e04e95',
  '1080x1920:highway+neck@3': 'c178685b',
  '1080x1920:highway+neck@1.3:loop': 'e3ef8aad',
  '1080x1920:tab+neck@0.5': '653f39b4',
  '1080x1920:tab+neck@1.1': '17cde232',
  '1080x1920:tab+neck@1.3': '01006c53',
  '1080x1920:tab+neck@3': 'cda35af3',
  '1080x1920:tab+neck@1.3:loop': 'd268ad42',
  '1080x1920:neck+pick@0.5': '65277bad',
  '1080x1920:neck+pick@1.1': '84c909f8',
  '1080x1920:neck+pick@1.3': '6e152bdb',
  '1080x1920:neck+pick@3': '6cc9f531',
  '1080x1920:neck+pick@1.3:loop': '06335927',
};

describe('frames that must not change', () => {
  it.each(CASES)('$key draws as it did before the waterfall columns', ({ key, run }) => {
    expect(run(), `no pinned hash for ${key}`).toBe(PINNED[key]);
  });

  it('draws the same frame twice for the same time', () => {
    expect(hashOf(1920, 1080, ['highway', 'tab'], 1.3, 4)).toBe(hashOf(1920, 1080, ['highway', 'tab'], 1.3, 4));
  });

  it('can tell frames apart: a different look-ahead changes a frame that shows dots', () => {
    expect(hashOf(1920, 1080, ['highway', 'fretboard'], 1.3, 1)).not.toBe(hashOf(1920, 1080, ['highway', 'fretboard'], 1.3, 6));
  });
});

// Set PRINT_FRAME_HASHES to a file path and run this file to write the current hashes there as JSON.
describe.skipIf(!process.env.PRINT_FRAME_HASHES)('PRINT', () => {
  it('prints the hash table', () => {
    const table = Object.fromEntries(CASES.map((c) => [c.key, c.run()]));
    writeFileSync(process.env.PRINT_FRAME_HASHES as string, JSON.stringify(table, null, 2));
    expect(Object.keys(table).length).toBe(CASES.length);
  });
});
