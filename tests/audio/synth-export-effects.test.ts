import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as alphaTab from '@coderline/alphatab';

const renderWithEffects = vi.hoisted(() => vi.fn(async (pcm: unknown) => ({ ...(pcm as object), marker: 'with effects' })));

vi.mock('../../src/audio/synth-effects', () => ({
  renderWithEffects,
  installLiveEffects: () => ({ remove: () => {}, setEnabled: () => {}, output: null }),
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

  it('covers AE5: with the effects switched off, the export is plain too, matching what was heard', async () => {
    const clock = clockWithExport();
    clock.setEffects(false);
    expect(clock.effectsOn).toBe(false);
    const pcm = await clock.exportAudio();
    expect(renderWithEffects).not.toHaveBeenCalled();
    expect((pcm as unknown as { marker?: string }).marker).toBeUndefined();
  });

  it('follows the switch back on', async () => {
    const clock = clockWithExport();
    clock.setEffects(false);
    clock.setEffects(true);
    await clock.exportAudio();
    expect(renderWithEffects).toHaveBeenCalledTimes(1);
  });

  it('keeps the alignment plain while the effects are on', async () => {
    const clock = clockWithExport();
    clock.setEffects(true);
    await clock.exportAudio(undefined, { fullBand: true, effects: false });
    expect(renderWithEffects).not.toHaveBeenCalled();
  });

  it('passes the switch to the live chain it is bound to', () => {
    const clock = clockWithExport();
    const live = vi.fn();
    clock.bindLiveEffects(live);
    clock.setEffects(false);
    expect(live).toHaveBeenLastCalledWith(false);
    clock.setEffects(true);
    expect(live).toHaveBeenLastCalledWith(true);
  });
});
