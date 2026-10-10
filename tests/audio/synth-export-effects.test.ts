import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as alphaTab from '@coderline/alphatab';

const renderWithEffects = vi.hoisted(() => vi.fn(async (pcm: unknown) => ({ ...(pcm as object), marker: 'with effects' })));

vi.mock('../../src/audio/synth-effects', () => ({
  renderWithEffects,
  installLiveEffects: () => () => {},
}));

import { SynthClock } from '../../src/audio/synth-bridge';

function clockWithExport() {
  const noop = { on: () => () => {} };
  const api = {
    playerPositionChanged: noop,
    playerStateChanged: noop,
    playerReady: noop,
    destroy: vi.fn(),
    score: { tracks: [] },
    exportAudio: vi.fn(async () => {
      const chunks = [{ samples: new Float32Array(8), currentTime: 1, endTime: 1 }];
      return { render: async () => chunks.shift() ?? null, destroy: vi.fn() };
    }),
  };
  return new SynthClock(api as unknown as alphaTab.AlphaTabApi, 60, [{ tick: 0, tempo: 120 }], 0);
}

describe('exportAudio effects', () => {
  beforeEach(() => renderWithEffects.mockClear());

  it('applies the effects by default', async () => {
    const pcm = await clockWithExport().exportAudio();
    expect(renderWithEffects).toHaveBeenCalledTimes(1);
    expect((pcm as unknown as { marker: string }).marker).toBe('with effects');
  });

  it('leaves the sound plain when asked, as the alignment does', async () => {
    const pcm = await clockWithExport().exportAudio(undefined, { effects: false });
    expect(renderWithEffects).not.toHaveBeenCalled();
    expect((pcm as unknown as { marker?: string }).marker).toBeUndefined();
  });
});
