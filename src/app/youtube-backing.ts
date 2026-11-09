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
