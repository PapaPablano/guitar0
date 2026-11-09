import { describe, expect, it } from 'vitest';
import { controlsFor, statusText } from '../../src/app/alignment-controls';
import type { AlignStatus } from '../../src/app/auto-align';

describe('statusText', () => {
  it('says nothing while idle', () => {
    expect(statusText({ phase: 'idle' })).toBe('');
  });

  it('says what is happening while a recording is lined up, and when an older timing is being detected again', () => {
    expect(statusText({ phase: 'waiting' })).toMatch(/waiting/i);
    expect(statusText({ phase: 'analysing', progress: 0.4 })).toBe('Lining the recording up with the tab… 40%');
    expect(statusText({ phase: 'analysing', progress: 0.4, again: true })).toBe("Detecting this recording's timing again… 40%");
  });

  it('names the three outcomes: lined up, roughly lined up, and not lined up with the reason', () => {
    expect(statusText({ phase: 'lined-up', skipped: 0 })).toBe('Lined up with the tab.');
    expect(statusText({ phase: 'roughly', skipped: 0 })).toMatch(/roughly lined up/i);
    expect(statusText({ phase: 'roughly', skipped: 0 })).toMatch(/few hundredths/);
    expect(statusText({ phase: 'not-found', reason: 'inconsistent' })).toMatch(/consistent/);
    expect(statusText({ phase: 'not-found', reason: 'not-confident' })).toMatch(/offset alone/);
    expect(statusText({ phase: 'failed', reason: 'no-sound' })).toMatch(/offset alone/);
    expect(statusText({ phase: 'failed', reason: 'worker' })).toMatch(/failed/);
  });

  it('covers AE3: names the reference a timeline came from, the viewed track or the whole band', () => {
    expect(statusText({ phase: 'lined-up', skipped: 0, basis: 'track' })).toBe('Lined up with the tab, using the track on screen.');
    expect(statusText({ phase: 'lined-up', skipped: 0, basis: 'band' })).toBe('Lined up with the tab, using the whole band.');
    expect(statusText({ phase: 'roughly', skipped: 0, basis: 'band' })).toMatch(/Roughly lined up.*few hundredths of a second\. The whole band was used\./);
    expect(statusText({ phase: 'roughly', skipped: 0, basis: 'track' })).toMatch(/The track on screen was used\./);
  });

  it('covers AE1: says when bar 1 was set to the first sound of the recording, for both outcomes and with the reference', () => {
    expect(statusText({ phase: 'lined-up', skipped: 0, startSet: true })).toBe("Lined up with the tab. Bar 1 was set to the recording's first sound.");
    expect(statusText({ phase: 'roughly', skipped: 0, startSet: true })).toMatch(/few hundredths of a second\. Bar 1 was set to the recording's first sound\.$/);
    expect(statusText({ phase: 'lined-up', skipped: 0, basis: 'band', startSet: true })).toBe(
      "Lined up with the tab, using the whole band. Bar 1 was set to the recording's first sound.",
    );
  });

  it('reads as it always has when the reference is not known, as for a saved timeline', () => {
    expect(statusText({ phase: 'lined-up', skipped: 0 })).toBe('Lined up with the tab.');
    expect(statusText({ phase: 'roughly', skipped: 0 })).toBe(
      'Roughly lined up: some bar lines may be off by more than a few hundredths of a second.',
    );
  });

  it('mentions the stretches the recording skips', () => {
    expect(statusText({ phase: 'lined-up', skipped: 1 })).toMatch(/1 stretch the recording skips/);
    expect(statusText({ phase: 'lined-up', skipped: 2 })).toMatch(/2 stretches the recording skips/);
  });

  it('says the timeline already in use was kept when a new detection fails the check', () => {
    expect(statusText({ phase: 'kept-previous' })).toMatch(/kept/);
  });

  it('says why the earlier timeline was kept when detection ran because the tab changed or the saved one no longer matched', () => {
    expect(statusText({ phase: 'kept-previous', cause: 'tab-changed' })).toMatch(/tab has changed.*kept/);
    expect(statusText({ phase: 'kept-previous', cause: 'check-failed' })).toMatch(/no longer matched this recording.*kept/);
  });

  it('no longer promises correction by hand in any state', () => {
    const states: AlignStatus[] = [
      { phase: 'lined-up', skipped: 0 },
      { phase: 'roughly', skipped: 0 },
      { phase: 'not-found', reason: 'silent' },
      { phase: 'kept-previous' },
    ];
    for (const status of states) expect(statusText(status)).not.toMatch(/extra playing|manual|Re-analyse to/i);
  });
});

describe('controlsFor', () => {
  const have = { hasTimeline: true, hasRecordingFile: true };
  const none = { hasTimeline: false, hasRecordingFile: true };

  it('shows the offset only while there is no timeline and no detection is running', () => {
    expect(controlsFor({ phase: 'lined-up', skipped: 0 }, have).showOffset).toBe(false);
    expect(controlsFor({ phase: 'roughly', skipped: 0 }, have).showOffset).toBe(false);
    expect(controlsFor({ phase: 'not-found', reason: 'silent' }, none).showOffset).toBe(true);
    expect(controlsFor({ phase: 'failed', reason: 'decode' }, none).showOffset).toBe(true);
    expect(controlsFor({ phase: 'analysing', progress: 0.1 }, none).showOffset).toBe(false);
    expect(controlsFor({ phase: 'waiting' }, none).showOffset).toBe(false);
    expect(controlsFor({ phase: 'kept-previous' }, have).showOffset).toBe(false);
  });

  it('keeps export unavailable, with a reason, only while detection runs or waits', () => {
    expect(controlsFor({ phase: 'analysing', progress: 0.5 }, have).exportBlockedReason).toMatch(/lined up/);
    expect(controlsFor({ phase: 'waiting' }, none).exportBlockedReason).not.toBeNull();
    expect(controlsFor({ phase: 'lined-up', skipped: 0 }, have).exportBlockedReason).toBeNull();
    expect(controlsFor({ phase: 'not-found', reason: 'silent' }, none).exportBlockedReason).toBeNull();
  });

  it('allows Re-analyse only with a recording file and no detection running', () => {
    expect(controlsFor({ phase: 'lined-up', skipped: 0 }, have).canReanalyse).toBe(true);
    expect(controlsFor({ phase: 'analysing', progress: 0 }, have).canReanalyse).toBe(false);
    expect(controlsFor({ phase: 'lined-up', skipped: 0 }, { hasTimeline: true, hasRecordingFile: false }).canReanalyse).toBe(false);
  });
});
