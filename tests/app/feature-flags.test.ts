import { describe, expect, it } from 'vitest';
import { readYoutubeFlag } from '../../src/app/feature-flags';

describe('youtube flag', () => {
  it('is on in a build that does not turn it off, and off unless the build defines exactly true', () => {
    // with no value passed the build's own definition is read, and vite.config.ts defines it on by default
    expect(readYoutubeFlag()).toBe(true);
    expect(readYoutubeFlag(null)).toBe(false);
    expect(readYoutubeFlag(false)).toBe(false);
    expect(readYoutubeFlag('true')).toBe(false);
    expect(readYoutubeFlag(true)).toBe(true);
  });
});
