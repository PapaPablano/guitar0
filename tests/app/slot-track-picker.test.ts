import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SlotTrackPicker } from '../../src/app/SlotTrackPicker';
import { surfaceLabel } from '../../src/app/panel-draw';
import type { TrackInfo } from '../../src/model/score';
import { makeTimeline, makeTwoTrackTimeline } from '../helpers/make-timeline';

const track = (index: number, name: string, isPercussion = false): TrackInfo => ({
  index,
  name,
  stringCount: 6,
  tuning: [],
  hasTabData: true,
  isPercussion,
  program: 30,
});

const html = (tracks: TrackInfo[], value?: number) => renderToStaticMarkup(createElement(SlotTrackPicker, { tracks, value, onChange: () => {} }));

describe('the track chooser for a panel', () => {
  it('lists the playable tracks after "Same as the picker"', () => {
    const out = html([track(0, 'Guitar'), track(1, 'Bass'), track(2, 'Drums', true)]);
    expect(out).toContain('Same as the picker');
    expect(out).toContain('Guitar');
    expect(out).toContain('Bass');
    expect(out).not.toContain('Drums');
  });

  it('is absent when the song has one playable track', () => {
    expect(html([track(0, 'Guitar')])).toBe('');
    expect(html([track(0, 'Guitar'), track(1, 'Drums', true)])).toBe('');
  });

  it('shows the chosen track as selected', () => {
    expect(html([track(0, 'Guitar'), track(1, 'Bass')], 1)).toMatch(/<option value="1" selected/);
  });
});

describe('a panel label', () => {
  it('names the panel\'s own track', () => {
    const band = makeTwoTrackTimeline(makeTimeline([{ start: 1, end: 2 }]), makeTimeline([{ start: 1, end: 2 }], 2, 4, 4));
    expect(surfaceLabel('neck', band, 1, 0)).toContain('track Bass');
    expect(surfaceLabel('neck', band, 0, 0)).toContain('track Guitar');
  });
});
