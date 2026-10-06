/** Counts the player in before playback resumes: a short click on each beat. */
export interface CountIn {
  /** Plays `beats` clicks at `bpm`, resolving true after the last beat's time has gone by, or false when cancelled first. */
  play(beats: number, bpm: number): Promise<boolean>;
  cancel(): void;
}

/** Seconds from the start of the count-in to the first click, so the sound has begun before the first click is due. */
const LEAD_SECONDS = 0.05;
/** A tempo this slow or this fast is not what a bar means; the count-in stays in a range a player can follow. */
const MIN_BPM = 30;
const MAX_BPM = 300;

/** When each click sounds, in seconds from `start`, one beat apart. */
export function clickTimes(beats: number, bpm: number, start: number): number[] {
  const interval = 60 / Math.min(MAX_BPM, Math.max(MIN_BPM, Number.isFinite(bpm) ? bpm : 120));
  return Array.from({ length: Math.max(0, beats) }, (_, k) => start + LEAD_SECONDS + k * interval);
}

interface Oscillator {
  readonly frequency: { value: number };
  connect(node: unknown): void;
  start(at: number): void;
  stop(at: number): void;
}

interface Gain {
  readonly gain: { setValueAtTime(value: number, at: number): void; exponentialRampToValueAtTime(value: number, at: number): void };
  connect(node: unknown): void;
}

/** The slice of an audio context the clicks use, so tests pass a fake. */
export interface ClickAudio {
  readonly currentTime: number;
  readonly destination: unknown;
  createOscillator(): Oscillator;
  createGain(): Gain;
  resume(): Promise<void>;
}

/** A count-in of short tones made with Web Audio: no sound file is needed. The first beat of the bar is higher. */
export class ClickCountIn implements CountIn {
  private context: ClickAudio | null = null;
  private pending: { timer: ReturnType<typeof setTimeout>; finish: (completed: boolean) => void; oscillators: Oscillator[] } | null = null;

  constructor(private readonly makeContext: () => ClickAudio = () => new AudioContext() as unknown as ClickAudio) {}

  async play(beats: number, bpm: number): Promise<boolean> {
    this.cancel();
    let context: ClickAudio | null = null;
    try {
      this.context ??= this.makeContext();
      await this.context.resume();
      context = this.context;
    } catch {
      // No sound to count with; the wait is still kept, so the player has the time to get ready.
    }
    const times = clickTimes(beats, bpm, context ? context.currentTime : 0);
    const interval = 60 / Math.min(MAX_BPM, Math.max(MIN_BPM, Number.isFinite(bpm) ? bpm : 120));
    const oscillators: Oscillator[] = [];
    if (context) {
      times.forEach((at, k) => {
        const osc = context.createOscillator();
        const gain = context.createGain();
        osc.frequency.value = k === 0 ? 1500 : 1000;
        gain.gain.setValueAtTime(0.5, at);
        gain.gain.exponentialRampToValueAtTime(0.001, at + 0.05);
        osc.connect(gain);
        gain.connect(context.destination);
        osc.start(at);
        osc.stop(at + 0.06);
        oscillators.push(osc);
      });
    }
    return new Promise<boolean>((resolve) => {
      const finish = (completed: boolean) => {
        if (this.pending?.finish === finish) this.pending = null;
        resolve(completed);
      };
      const wait = (LEAD_SECONDS + beats * interval) * 1000;
      const timer = setTimeout(() => finish(true), wait);
      this.pending = { timer, finish, oscillators };
    });
  }

  cancel(): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    for (const osc of pending.oscillators) {
      try {
        osc.stop(0);
      } catch {
        // A tone that has already ended cannot be stopped again.
      }
    }
    pending.finish(false);
  }
}
