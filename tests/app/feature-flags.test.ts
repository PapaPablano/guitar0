import { describe, expect, it } from 'vitest';
import { readYoutubeFlag, youtubeControls } from '../../src/app/feature-flags';

describe('youtube flag', () => {
  it('is off unless the build defines exactly true', () => {
    expect(readYoutubeFlag(undefined)).toBe(false);
    expect(readYoutubeFlag(false)).toBe(false);
    expect(readYoutubeFlag('true')).toBe(false);
    expect(readYoutubeFlag(true)).toBe(true);
  });

  it('off: no search input, results or import control, even with results and a ready engine', () => {
    expect(youtubeControls({ enabled: false, stemsEnabled: true, hasResults: true })).toEqual({ search: false, searchUsable: false, results: false });
  });

  it('on: shows the search input always (usable once stems are enabled), and results when there are some', () => {
    expect(youtubeControls({ enabled: true, stemsEnabled: true, hasResults: false })).toEqual({ search: true, searchUsable: true, results: false });
    expect(youtubeControls({ enabled: true, stemsEnabled: true, hasResults: true })).toEqual({ search: true, searchUsable: true, results: true });
    expect(youtubeControls({ enabled: true, stemsEnabled: false, hasResults: false })).toEqual({ search: true, searchUsable: false, results: false });
  });

  it('a saved entry keyed by a link surfaces no control when off (the view state takes no saved-entry input)', () => {
    const view = youtubeControls({ enabled: false, stemsEnabled: true, hasResults: false });
    expect(view.search || view.results).toBe(false);
  });
});
