import { describe, expect, it } from 'vitest';
import { methodsFor } from '../../src/app/backing-track';

describe('methodsFor', () => {
  it('offers only loading a file when the video option is off', () => {
    expect(methodsFor({ video: false })).toEqual(['file']);
  });

  it('offers a YouTube video as well when the option is on, on the web or on desktop alike', () => {
    expect(methodsFor({ video: true })).toEqual(['file', 'video']);
  });
});
