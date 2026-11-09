import { describe, expect, it } from 'vitest';
import type { Clock } from '../../src/audio/clock';
import { FREE, embedAllowed, type TierState } from '../../src/app/tier';
import { chooseClock, exportVideoNotice, ownClock, videoIsHeard, videoOffered } from '../../src/app/youtube-backing';
import { dockRules } from '../../src/app/youtube-dock';

const clock = (name: string) => ({ name }) as unknown as Clock;
const video = clock('video');
const stems = clock('stems');
const recording = clock('recording');
const synth = clock('synth');
const PRO: TierState = { ...FREE, tier: 'pro' };

describe('chooseClock', () => {
  it('uses the video clock with a video attached and Original on', () => {
    expect(chooseClock({ video, source: 'original', stems, userClock: recording, session: synth })).toBe(video);
  });

  it('uses the synth clock with Synth chosen and nothing else loaded', () => {
    expect(chooseClock({ video, source: 'synth', stems: null, userClock: null, session: synth })).toBe(synth);
  });

  it('keeps the existing order without a video: stems, then the loaded recording, then the synth', () => {
    expect(chooseClock({ video: null, source: 'original', stems, userClock: recording, session: synth })).toBe(stems);
    expect(chooseClock({ video: null, source: 'original', stems: null, userClock: recording, session: synth })).toBe(recording);
    expect(chooseClock({ video: null, source: 'original', stems: null, userClock: null, session: synth })).toBe(synth);
  });

  it('plays a loaded recording, not the synth, when Synth is chosen with one loaded', () => {
    expect(chooseClock({ video, source: 'synth', stems: null, userClock: recording, session: synth })).toBe(recording);
  });

  it('is empty when nothing can play', () => {
    expect(chooseClock({ video: null, source: 'original', stems: null, userClock: null, session: null })).toBeUndefined();
  });
});

describe('ownClock', () => {
  it('is what plays without the video, in the existing order', () => {
    expect(ownClock({ stems, userClock: recording, session: synth })).toBe(stems);
    expect(ownClock({ stems: null, userClock: null, session: synth })).toBe(synth);
  });
});

describe('export notice', () => {
  it('tells the player the offline export leaves the video out, and where to include it, only while one is attached', () => {
    expect(exportVideoNotice(true)).toMatch(/leaves out the YouTube video[\s\S]*Record with video/);
    expect(exportVideoNotice(false)).toBeNull();
  });
});

describe('dockRules', () => {
  it('covers AE2: the video cannot be minimized while the original audio plays', () => {
    expect(dockRules(true, 'original').canMinimize).toBe(false);
  });

  it('lets the video be minimized in Synth mode', () => {
    expect(dockRules(true, 'synth').canMinimize).toBe(true);
  });

  it('keeps a full-screen panel from taking the screen from the browser while the original plays', () => {
    expect(dockRules(true, 'original').panelMayUseBrowserFullscreen).toBe(false);
    expect(dockRules(true, 'synth').panelMayUseBrowserFullscreen).toBe(true);
    expect(dockRules(false, 'original').panelMayUseBrowserFullscreen).toBe(true);
  });
});

describe('videoIsHeard', () => {
  it('is true only with a video attached and Original chosen', () => {
    expect(videoIsHeard(true, 'original')).toBe(true);
    expect(videoIsHeard(true, 'synth')).toBe(false);
    expect(videoIsHeard(false, 'original')).toBe(false);
  });
});

describe('videoOffered', () => {
  it('offers the video on the web and on desktop alike for a Pro tier, whatever the shell remote switch says', () => {
    expect(embedAllowed({ ...PRO, youtube: false })).toBe(true);
    expect(videoOffered(true, { ...PRO, youtube: false })).toBe(true);
  });

  it('does not offer it when the build flag is off', () => {
    expect(videoOffered(false, PRO)).toBe(false);
  });
});
