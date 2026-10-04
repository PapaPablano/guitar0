import { describe, expect, it } from 'vitest';
import { readYoutubeFlag, youtubeControls } from '../../src/app/feature-flags';

describe('youtube flag', () => {
  it('defaults to off when the build defines nothing', () => {
    expect(readYoutubeFlag()).toBe(false);
  });

  it('off: no search input, results or import control, even with results and a ready engine', () => {
    expect(youtubeControls({ enabled: false, stemsEnabled: true, hasResults: true })).toEqual({ search: false, results: false });
  });

  it('on: shows the search input when stems are enabled, and results when there are some', () => {
    expect(youtubeControls({ enabled: true, stemsEnabled: true, hasResults: false })).toEqual({ search: true, results: false });
    expect(youtubeControls({ enabled: true, stemsEnabled: true, hasResults: true })).toEqual({ search: true, results: true });
    expect(youtubeControls({ enabled: true, stemsEnabled: false, hasResults: false }).search).toBe(false);
  });

  it('a saved entry keyed by a link surfaces no control when off (the view state takes no saved-entry input)', () => {
    const view = youtubeControls({ enabled: false, stemsEnabled: true, hasResults: false });
    expect(view.search || view.results).toBe(false);
  });
});
