import { describe, expect, it } from 'vitest';
import { alignmentNeedsLook, availableTools, currentTool } from '../../src/app/practice-tools';

describe('availableTools', () => {
  it('offers loop, recording and stems with nothing loaded', () => {
    expect(availableTools({ hasAudioSource: false, hasSections: false, desktop: true })).toEqual(['loop', 'recording', 'stems']);
  });

  it('adds alignment once there is a recording or stems', () => {
    expect(availableTools({ hasAudioSource: true, hasSections: false, desktop: true })).toEqual(['loop', 'recording', 'stems', 'alignment']);
  });

  it('adds sections only when there is audio and some were found', () => {
    expect(availableTools({ hasAudioSource: true, hasSections: true, desktop: true })).toEqual(['loop', 'sections', 'recording', 'stems', 'alignment']);
    expect(availableTools({ hasAudioSource: false, hasSections: true, desktop: true })).not.toContain('sections');
  });
});

describe('stems', () => {
  it('are left out of the browser build', () => {
    expect(availableTools({ hasAudioSource: false, hasSections: false, desktop: false })).toEqual(['loop', 'recording']);
  });
});

describe('currentTool', () => {
  it('keeps the wanted tool while it is available and falls back to the first when it goes away', () => {
    expect(currentTool('stems', ['loop', 'stems'])).toBe('stems');
    expect(currentTool('alignment', ['loop', 'stems'])).toBe('loop');
  });
});

describe('alignmentNeedsLook', () => {
  it('flags results that are not a clean line-up, and any change from detecting again', () => {
    expect(alignmentNeedsLook({ phase: 'failed', reason: 'decode' }, null)).toBe(true);
    expect(alignmentNeedsLook({ phase: 'roughly', skipped: 0 }, null)).toBe(true);
    expect(alignmentNeedsLook({ phase: 'lined-up', skipped: 0 }, null)).toBe(false);
    expect(alignmentNeedsLook({ phase: 'idle' }, null)).toBe(false);
    expect(alignmentNeedsLook({ phase: 'lined-up', skipped: 0 }, '3 bars re-pinned')).toBe(true);
  });
});
