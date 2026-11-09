import { describe, expect, it } from 'vitest';
import type { Clock } from '../../src/audio/clock';
import { FREE, embedAllowed, type TierState } from '../../src/app/tier';
import {
  chooseClock,
  createRestoreHold,
  exportVideoNotice,
  ownClock,
  takesOverFromVideo,
  videoIsHeard,
  videoOffered,
} from '../../src/app/youtube-backing';
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

describe('restore hold (AE2)', () => {
  /** Whether a recording or stems arriving now take over from the video's Original audio on the open tab. */
  const takesOver = (hold: ReturnType<typeof createRestoreHold>, openTab: string | null) =>
    takesOverFromVideo({ videoReady: true, ownLoaded: true, source: 'original', restoring: hold.holds(openTab) });

  it("applies a source restored before its tab opens on that tab's open, and not on another tab's", () => {
    const hold = createRestoreHold();
    expect(hold.restore('song', 'synth', null)).toBeNull();
    expect(hold.tabOpened('song')).toBe('synth');

    const other = createRestoreHold();
    other.restore('song', 'synth', null);
    expect(other.tabOpened('different')).toBe('original');
  });

  it('applies the source at once when its tab is already open', () => {
    const hold = createRestoreHold();
    hold.tabOpened('song');
    expect(hold.restore('song', 'synth', 'song')).toBe('synth');
    expect(hold.holds('song')).toBe(true);
  });

  it('keeps a recording or stems from taking over while the hold covers the open tab', () => {
    const hold = createRestoreHold();
    hold.restore('song', 'original', null);
    hold.tabOpened('song');
    expect(takesOver(hold, 'song')).toBe(false);
  });

  it("ends the hold on endRestore or a choice of the player's own, so a recording takes over again", () => {
    // attach, remove, the player's source choice and endRestore all end the hold the same way.
    for (const choice of ['attach', 'remove', 'source', 'endRestore']) {
      const hold = createRestoreHold();
      hold.restore('song', 'original', null);
      hold.tabOpened('song');
      hold.end();
      expect(hold.holds('song'), choice).toBe(false);
      expect(takesOver(hold, 'song'), choice).toBe(true);
    }
  });

  it('clears the hold when another tab opens, and does not bring it back on returning', () => {
    const hold = createRestoreHold();
    hold.restore('song', 'synth', null);
    hold.tabOpened('song');
    expect(hold.tabOpened('other')).toBe('original');
    expect(hold.holds('other')).toBe(false);
    expect(takesOver(hold, 'other')).toBe(true);
    expect(hold.tabOpened('song')).toBe('original');
    expect(hold.holds('song')).toBe(false);
  });

  it('consumes a waiting source once, so the tab reopening later opens with Original', () => {
    const hold = createRestoreHold();
    hold.restore('song', 'synth', null);
    expect(hold.tabOpened('song')).toBe('synth');
    expect(hold.tabOpened('song')).toBe('original');
  });

  it('never reports a player change: restore only hands back the source for the caller to apply silently', () => {
    const hold = createRestoreHold();
    // The hold has no callbacks to call; restoring yields a value or null and nothing else.
    expect(hold.restore('song', 'synth', 'song')).toBe('synth');
    expect(hold.restore('song', 'original', null)).toBeNull();
    expect(Object.keys(hold).sort()).toEqual(['end', 'holds', 'restore', 'tabOpened']);
  });
});
