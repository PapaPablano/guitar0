import type { Clock } from '../audio/clock';
import { embedAllowed, type TierState } from './tier';
import type { AudioSource } from './youtube-dock';

/** Whether the YouTube video option is offered: the build has it on and the player's tier allows it. */
export function videoOffered(flagOn: boolean, tier: TierState): boolean {
  return flagOn && embedAllowed(tier);
}

export interface ClockChoice {
  /** The video's clock, once its player is ready. */
  readonly video: Clock | null;
  readonly source: AudioSource;
  readonly stems: Clock | null | undefined;
  readonly userClock: Clock | null | undefined;
  readonly session: Clock | null | undefined;
}

/** What the app plays and follows: the video with Original on, otherwise the stems, the loaded recording, or the synth, in that order. */
export function chooseClock(choice: ClockChoice): Clock | undefined {
  if (choice.video && choice.source === 'original') return choice.video;
  return ownClock(choice);
}

/** The clock the video hands over to when it is parked, and takes over from: whatever plays without it. */
export function ownClock(choice: Omit<ClockChoice, 'video' | 'source'>): Clock | undefined {
  return choice.stems ?? choice.userClock ?? choice.session ?? undefined;
}

/** The sentence the export dialog shows while a video is attached, so the player knows what each export will carry. */
export function exportVideoNotice(attached: boolean): string | null {
  return attached ? 'The video export leaves out the YouTube video and uses the synth, or your loaded recording. To include the video and its sound, use Record with video.' : null;
}

/** Whether the video's audio is what is heard, so the controls that only suit the synth (play along, tone) stay out of the way. */
export function videoIsHeard(attached: boolean, source: AudioSource): boolean {
  return attached && source === 'original';
}

/** The switch the player sees for Original and Synth. */
export const SOURCE_LABELS: Record<AudioSource, string> = { original: 'Original', synth: 'Synth' };

/**
 * Whether a recording or stems that just appeared take over from the video: only while the video's own audio is heard, and
 * not while a reopened song is coming back with the video as its saved source (AE2).
 */
export function takesOverFromVideo(state: { videoReady: boolean; ownLoaded: boolean; source: AudioSource; restoring: boolean }): boolean {
  return state.videoReady && state.ownLoaded && state.source === 'original' && !state.restoring;
}

/**
 * The hold a reopened song puts on its saved audio source (AE2): the source waits for its tab to open, and while the hold
 * covers the open tab a recording or stems that appear do not take over from the video. Nothing here reports to the
 * library; the caller applies the returned source without telling anyone.
 */
export interface RestoreHold {
  /**
   * Holds `source` for the tab named `tabKey`. Returns the source to apply now when that tab is the one open, or null when
   * it waits for the tab to open.
   */
  restore(tabKey: string, source: AudioSource, openTab: string | null): AudioSource | null;
  /** A tab opened (or none is open): the source it opens with, which is the held one only for the tab it was held for. */
  tabOpened(tabKey: string | null): AudioSource;
  /** The player made a choice of their own (attach, remove, a source, or loading a recording themselves): the hold ends. */
  end(): void;
  /** Whether the hold covers the open tab, so a recording or stems arriving now do not take over. */
  holds(openTab: string | null): boolean;
}

export function createRestoreHold(): RestoreHold {
  /** A reopened song's source, waiting for its tab to open. */
  let pending: { tabKey: string; source: AudioSource } | null = null;
  /** The reopened tab whose recording or stems do not take over from the video; null when nothing is being restored. */
  let restoringTab: string | null = null;
  return {
    restore(tabKey, source, openTab) {
      restoringTab = tabKey;
      // From the start screen the tab is not open yet, so the source is applied when it opens.
      if (openTab === tabKey) return source;
      pending = { tabKey, source };
      return null;
    },
    tabOpened(tabKey) {
      const waiting = pending;
      pending = null;
      if (restoringTab !== tabKey) restoringTab = null;
      return waiting && waiting.tabKey === tabKey ? waiting.source : 'original';
    },
    end() {
      restoringTab = null;
    },
    holds(openTab) {
      return restoringTab !== null && restoringTab === openTab;
    },
  };
}
