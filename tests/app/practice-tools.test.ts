import { describe, expect, it } from 'vitest';
import { alignmentNeedsLook, availableTools, currentTool } from '../../src/app/practice-tools';

describe('availableTools', () => {
  it('offers loop and the backing track with nothing loaded', () => {
    expect(availableTools({ hasAudioSource: false, hasSections: false })).toEqual(['loop', 'backing']);
  });

  it('adds alignment once there is a recording or stems', () => {
    expect(availableTools({ hasAudioSource: true, hasSections: false })).toEqual(['loop', 'backing', 'alignment']);
  });

  it('adds sections only when there is audio and some were found', () => {
    expect(availableTools({ hasAudioSource: true, hasSections: true })).toEqual(['loop', 'sections', 'backing', 'alignment']);
    expect(availableTools({ hasAudioSource: false, hasSections: true })).not.toContain('sections');
  });
});

describe('backing track', () => {
  it('replaces the separate recording and stems tools', () => {
    const tools = availableTools({ hasAudioSource: true, hasSections: true });
    expect(tools).not.toContain('recording');
    expect(tools).not.toContain('stems');
  });
});

describe('currentTool', () => {
  it('keeps the wanted tool while it is available and falls back to the first when it goes away', () => {
    expect(currentTool('backing', ['loop', 'backing'])).toBe('backing');
    expect(currentTool('alignment', ['loop', 'backing'])).toBe('loop');
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
