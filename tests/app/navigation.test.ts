import { describe, expect, it } from 'vitest';
import { interpretKey, playbackBarIndexAt, seekByBar } from '../../src/app/navigation';
import { buildTimeline, loadAlphaTex } from '../../src/model/alphatab-adapter';
import { SAMPLE_ALPHATEX } from '../../src/app/sample';
import { REPEAT_AND_TEMPO } from '../fixtures/fixtures';

describe('seekByBar', () => {
  const timeline = buildTimeline(loadAlphaTex(REPEAT_AND_TEMPO));

  it('finds the bar containing a time, counting repeated bars separately', () => {
    expect(playbackBarIndexAt(timeline, 0)).toBe(0);
    expect(playbackBarIndexAt(timeline, 3)).toBe(1);
    expect(playbackBarIndexAt(timeline, 6.5)).toBe(3);
  });

  it('seeks to the next and previous played bar starts', () => {
    expect(seekByBar(timeline, 0.5, 1)).toBeCloseTo(2, 6);
    expect(seekByBar(timeline, 3, -1)).toBeCloseTo(0, 6);
  });

  it('stays within the song at both ends', () => {
    expect(seekByBar(timeline, 0, -1)).toBe(0);
    const last = timeline.bars[timeline.bars.length - 1];
    expect(seekByBar(timeline, last.startSeconds + 1, 1)).toBe(last.startSeconds);
  });
});

describe('interpretKey', () => {
  it('maps the documented shortcuts', () => {
    const body = { tag: 'BODY' };
    expect(interpretKey(' ', body)).toBe('toggle-play');
    expect(interpretKey('ArrowLeft', body)).toBe('seek-back');
    expect(interpretKey('ArrowRight', body)).toBe('seek-forward');
    expect(interpretKey('ArrowUp', body)).toBe('tempo-up');
    expect(interpretKey('ArrowDown', body)).toBe('tempo-down');
    expect(interpretKey('l', body)).toBe('toggle-loop');
    expect(interpretKey('f', body)).toBe('toggle-fullscreen');
    expect(interpretKey('F', { tag: 'input' })).toBeNull();
    expect(interpretKey('x', body)).toBeNull();
  });

  it('is suspended while a slider, text field or select has focus', () => {
    expect(interpretKey(' ', { tag: 'INPUT' })).toBeNull();
    expect(interpretKey('ArrowUp', { tag: 'INPUT' })).toBeNull();
    expect(interpretKey(' ', { tag: 'SELECT' })).toBeNull();
  });

  it('leaves Space to a focused button so it is not handled twice', () => {
    expect(interpretKey(' ', { tag: 'BUTTON' })).toBeNull();
    expect(interpretKey('ArrowLeft', { tag: 'BUTTON' })).toBe('seek-back');
  });
});

describe('bundled sample', () => {
  it('loads as a playable repeated riff', () => {
    const timeline = buildTimeline(loadAlphaTex(SAMPLE_ALPHATEX));
    expect(timeline.scoreBarCount).toBe(4);
    expect(timeline.bars.length).toBeGreaterThan(4);
    expect(timeline.notesForTrack(0).length).toBeGreaterThan(20);
    expect(timeline.durationSeconds).toBeGreaterThan(10);
  });
});
