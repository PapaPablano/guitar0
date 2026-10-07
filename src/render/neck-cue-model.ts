import type { NoteEvent } from '../model/score';
import { DEFAULT_LOOKAHEAD, stepsAt, type Step } from './fretboard-steps';

/** A bend of this many semitones or more deflects the string as far as it goes. */
export const FULL_BEND_SEMITONES = 2;
/** Share of a bent note's length over which the bend eases in. */
const BEND_EASE_SHARE = 0.4;
/** Frets a slide into or out of a note travels, as a short comet. */
export const SHORT_SLIDE_FRETS = 3;
/** Seconds before a note a slide into it is drawn arriving. */
const SLIDE_IN_SECONDS = 0.25;
/** Seconds a comet lingers after the note it belongs to ends, so it fades rather than vanishes. */
const COMET_LINGER_SECONDS = 0.2;
/** Share of the gap between strings a full bend moves the finger, and the most a vibrato rock moves it. */
export const BEND_REACH = 0.8;
export const SHIVER_REACH = 0.12;
export const SHIVER_HERTZ = 7;
/** A hammer-on destination's finger dips by this share, over this many seconds from the note's start. */
const TAP_DIP = 0.25;
const TAP_SECONDS = 0.12;
/** A pull-off origin's finger shrinks by this share over this many seconds before the note's end. */
const LIFT_SHRINK = 0.3;
const LIFT_SECONDS = 0.12;

/** The cue joining a note to the next later note on its string: a hammer-on or pull-off arc. */
export interface ArcCue {
  readonly from: NoteEvent;
  readonly to: NoteEvent;
}

/** A slide drawn as a bright comet whose head moves from one fret to another. */
export interface CometCue {
  readonly note: NoteEvent;
  readonly fromFret: number;
  readonly toFret: number;
  /** How far along the head is, 0 at `fromFret` and 1 at `toFret`. */
  readonly head: number;
  /** 1 while the note sounds, fading to 0 as the comet lingers after it. */
  readonly strength: number;
  readonly kind: 'between' | 'out' | 'in';
}

/** What a single note does to its lit string and ring. */
export interface NoteEffect {
  /** How far the string is deflected, 0 to 1 (1 is a full bend or more), easing in over the start of the note. */
  readonly bend: number;
  /** 1 while a vibrato note sounds, else 0. */
  readonly shiver: number;
  readonly muted: boolean;
}

/** The pulse from the playing step's anchor to the next step's anchor, arriving on the beat. */
export interface PulseCue {
  readonly from: NoteEvent;
  readonly to: NoteEvent;
  /** 0 at the playing step's start, 1 when the next step starts. */
  readonly progress: number;
}

/**
 * Where a note's finger is, and how it presses, while the note moves. The ring is drawn from it and the lit string leaves it,
 * so the two cannot disagree. A note at rest has no pose.
 */
export interface FingerPose {
  /** The fret the finger is at, which may be between whole frets while it slides. */
  readonly fret: number;
  /** How far the finger is across the strings, in shares of the gap to the next string; positive is toward the lower-pitched one. */
  readonly across: number;
  /** Size multiplier: 1 at rest, below 1 while the finger taps down or lifts off. */
  readonly press: number;
}

export interface NeckCues {
  readonly arcs: readonly ArcCue[];
  readonly comets: readonly CometCue[];
  /** Effects by note id, only for notes that have one. */
  readonly effects: ReadonlyMap<string, NoteEffect>;
  /** Notes that carry a harmonic. */
  readonly harmonics: readonly NoteEvent[];
  /** Ids of the notes a hammer-on or pull-off ends on: not picked. */
  readonly unpicked: ReadonlySet<string>;
  readonly pulse: PulseCue | null;
  /** The finger pose by note id, only for notes that move. */
  readonly poses: ReadonlyMap<string, FingerPose>;
}

const NONE: NeckCues = { arcs: [], comets: [], effects: new Map(), harmonics: [], unpicked: new Set(), pulse: null, poses: new Map() };

/**
 * Which way a bent string is pushed on a track with `stringCount` strings: 1 toward the lower-pitched neighbour for the upper half of
 * the strings (G, B and e on a six-string guitar), -1 toward the higher-pitched one for the rest. String 1 is the highest-pitched.
 */
export function bendSide(string: number, stringCount: number): 1 | -1 {
  return string <= Math.floor(stringCount / 2) ? 1 : -1;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const smooth = (v: number): number => {
  const x = clamp01(v);
  return x * x * (3 - 2 * x);
};

/** The next note after `note` on the same string, from notes in playback order. */
export function nextOnString(notes: readonly NoteEvent[], note: NoteEvent): NoteEvent | undefined {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].startSeconds <= note.startSeconds) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < notes.length; i++) if (notes[i].string === note.string) return notes[i];
  return undefined;
}

/** The note a step is drawn from: its lowest-pitched one, as the fretboard's path does. */
function anchorOf(step: Step): NoteEvent {
  return step.notes.reduce((low, n) => (n.string > low.string ? n : low));
}

function effectOf(note: NoteEvent, t: number): NoteEffect | null {
  const tech = note.techniques;
  const sounding = t >= note.startSeconds && t <= note.endSeconds;
  const length = Math.max(1e-6, note.endSeconds - note.startSeconds);
  const bend = tech.bend > 0 && sounding ? clamp01(tech.bend / FULL_BEND_SEMITONES) * smooth((t - note.startSeconds) / (length * BEND_EASE_SHARE)) : 0;
  const shiver = tech.vibrato && sounding ? 1 : 0;
  if (bend === 0 && shiver === 0 && !tech.palmMute) return null;
  return { bend, shiver, muted: tech.palmMute };
}

function cometsOf(notes: readonly NoteEvent[], note: NoteEvent, t: number): CometCue[] {
  const slide = note.techniques.slide;
  if (slide === 'none') return [];
  const length = Math.max(1e-6, note.endSeconds - note.startSeconds);
  const sounding = (until: number) => t >= note.startSeconds && t <= until;
  if (slide === 'shift' || slide === 'legato') {
    const target = nextOnString(notes, note);
    if (!target || !sounding(note.endSeconds + COMET_LINGER_SECONDS)) return [];
    const after = Math.max(0, t - note.endSeconds);
    return [{ note, fromFret: note.fret, toFret: target.fret, head: clamp01((t - note.startSeconds) / length), strength: 1 - clamp01(after / COMET_LINGER_SECONDS), kind: 'between' }];
  }
  if (slide === 'out-down' || slide === 'out-up') {
    if (!sounding(note.endSeconds + COMET_LINGER_SECONDS)) return [];
    const toFret = Math.max(0, note.fret + (slide === 'out-up' ? SHORT_SLIDE_FRETS : -SHORT_SLIDE_FRETS));
    const after = Math.max(0, t - note.endSeconds);
    return [{ note, fromFret: note.fret, toFret, head: clamp01((t - note.startSeconds) / length), strength: 1 - clamp01(after / COMET_LINGER_SECONDS), kind: 'out' }];
  }
  // a slide into the note arrives from below or above just before it starts
  const fromFret = Math.max(0, note.fret + (slide === 'in-above' ? SHORT_SLIDE_FRETS : -SHORT_SLIDE_FRETS));
  const begin = note.startSeconds - SLIDE_IN_SECONDS;
  if (t < begin || t > note.startSeconds + COMET_LINGER_SECONDS) return [];
  const after = Math.max(0, t - note.startSeconds);
  return [{ note, fromFret, toFret: note.fret, head: clamp01((t - begin) / SLIDE_IN_SECONDS), strength: 1 - clamp01(after / COMET_LINGER_SECONDS), kind: 'in' }];
}

/**
 * The technique cues to draw on the neck at time `t`, for the notes in the window the neck view shows (the playing step, the
 * trail behind it and the steps ahead). A pure function of its arguments: the same notes and time give the same cues.
 */
export function cuesAt(notes: readonly NoteEvent[], t: number, lookahead: number = DEFAULT_LOOKAHEAD, stringCount = 6): NeckCues {
  const steps = stepsAt(notes, t, lookahead);
  const window = [...steps.trail, ...(steps.playing ? [steps.playing] : []), ...steps.upcoming].flatMap((s) => s.notes);
  if (window.length === 0) return NONE;

  const arcs: ArcCue[] = [];
  const comets: CometCue[] = [];
  const effects = new Map<string, NoteEffect>();
  const harmonics: NoteEvent[] = [];
  const unpicked = new Set<string>();
  const poses = new Map<string, FingerPose>();
  const pose = (note: NoteEvent): { fret: number; across: number; press: number } => {
    const existing = poses.get(note.id);
    return existing ? { ...existing } : { fret: note.fret, across: 0, press: 1 };
  };
  for (const note of window) {
    const tech = note.techniques;
    if (tech.hammerPull === 'origin') {
      const to = nextOnString(notes, note);
      if (to) arcs.push({ from: note, to });
    }
    if (tech.hammerPull === 'destination') unpicked.add(note.id);
    const noteComets = cometsOf(notes, note, t);
    comets.push(...noteComets);
    const effect = effectOf(note, t);
    if (effect) effects.set(note.id, effect);
    if (tech.harmonic) harmonics.push(note);

    const moving = pose(note);
    for (const comet of noteComets) {
      // the finger rides the slide while the note sounds, and arrives with it for a slide into the note
      if (comet.kind === 'in' || t <= note.endSeconds) moving.fret = comet.fromFret + (comet.toFret - comet.fromFret) * comet.head;
    }
    if (effect) moving.across += (effect.bend > 0 ? effect.bend * BEND_REACH * bendSide(note.string, stringCount) : 0) + effect.shiver * SHIVER_REACH * Math.sin(2 * Math.PI * SHIVER_HERTZ * t);
    setIfMoved(poses, note, moving);
  }
  for (const { from, to } of arcs) {
    if (to.fret > from.fret) {
      // a hammer-on: the finger lands on the destination, dipping as it taps down
      const since = t - to.startSeconds;
      if (since >= 0 && since <= TAP_SECONDS) {
        const moving = pose(to);
        moving.press = 1 - TAP_DIP * smooth(1 - since / TAP_SECONDS);
        setIfMoved(poses, to, moving);
      }
    } else if (to.fret < from.fret) {
      // a pull-off: the finger lifts from the origin as the note ends
      const left = from.endSeconds - t;
      if (left >= 0 && left <= LIFT_SECONDS) {
        const moving = pose(from);
        moving.press = 1 - LIFT_SHRINK * smooth(1 - left / LIFT_SECONDS);
        setIfMoved(poses, from, moving);
      }
    }
  }

  let pulse: PulseCue | null = null;
  const next = steps.upcoming[0];
  if (steps.playing && next) {
    const from = anchorOf(steps.playing);
    const to = anchorOf(next);
    if (from.string !== to.string || from.fret !== to.fret) {
      const span = Math.max(1e-6, next.startSeconds - steps.playing.startSeconds);
      pulse = { from, to, progress: smooth((t - steps.playing.startSeconds) / span) };
    }
  }
  return { arcs, comets, effects, harmonics, unpicked, pulse, poses };
}

function setIfMoved(poses: Map<string, FingerPose>, note: NoteEvent, pose: FingerPose): void {
  if (pose.fret !== note.fret || pose.across !== 0 || pose.press !== 1) poses.set(note.id, pose);
}
