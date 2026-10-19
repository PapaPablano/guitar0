import { describe, expect, it } from 'vitest';
import { readYoutubeFlag, youtubeControls } from '../../src/app/feature-flags';

describe('youtube flag', () => {
  it('is on in a build that does not turn it off, and off unless the build defines exactly true', () => {
    // with no value passed the build's own definition is read, and vite.config.ts defines it on by default
    expect(readYoutubeFlag()).toBe(true);
    expect(readYoutubeFlag(null)).toBe(false);
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
