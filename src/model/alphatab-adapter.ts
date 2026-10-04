import * as alphaTab from '@coderline/alphatab';
import type { BarEvent, NoteEvent, SlideKind, TempoPoint, Techniques, Timeline, TrackInfo } from './score';

const TICKS_PER_QUARTER = 960;
/** Standard guitar tuning, highest string first (E4 B3 G3 D3 A2 E2). */
const STANDARD_TUNING = [64, 59, 55, 50, 45, 40];

/** Converts an absolute tick to seconds through a tempo map sorted by tick. */
export function ticksToSeconds(points: readonly TempoPoint[], tick: number): number {
  let seconds = 0;
  for (let i = 0; i < points.length; i++) {
    const start = points[i].tick;
    if (tick <= start) break;
    const end = i + 1 < points.length ? Math.min(points[i + 1].tick, tick) : tick;
    seconds += ((end - start) / TICKS_PER_QUARTER) * (60 / points[i].tempo);
  }
  return seconds;
}

/** Inverse of ticksToSeconds: the tick reached after `seconds` of playback. */
export function secondsToTicks(points: readonly TempoPoint[], seconds: number): number {
  let remaining = Math.max(0, seconds);
  for (let i = 0; i < points.length; i++) {
    const secondsPerTick = 60 / points[i].tempo / TICKS_PER_QUARTER;
    const next = points[i + 1];
    const segmentSeconds = next ? (next.tick - points[i].tick) * secondsPerTick : Infinity;
    if (remaining <= segmentSeconds) return points[i].tick + remaining / secondsPerTick;
    remaining -= segmentSeconds;
  }
  return 0;
}

export function loadScoreFromBytes(data: Uint8Array): alphaTab.model.Score {
  return alphaTab.importer.ScoreLoader.loadScoreFromBytes(data, new alphaTab.Settings());
}

export function loadAlphaTex(tex: string): alphaTab.model.Score {
  return alphaTab.importer.ScoreLoader.loadAlphaTex(tex, new alphaTab.Settings());
}

function slideKind(note: alphaTab.model.Note): SlideKind {
  switch (note.slideOutType) {
    case alphaTab.model.SlideOutType.Shift:
      return 'shift';
    case alphaTab.model.SlideOutType.Legato:
      return 'legato';
    case alphaTab.model.SlideOutType.OutDown:
      return 'out-down';
    case alphaTab.model.SlideOutType.OutUp:
      return 'out-up';
    default:
      break;
  }
  switch (note.slideInType) {
    case alphaTab.model.SlideInType.IntoFromBelow:
      return 'in-below';
    case alphaTab.model.SlideInType.IntoFromAbove:
      return 'in-above';
    default:
      return 'none';
  }
}

/** alphaTab bend points run 0-60 in position and carry values where 2 equals one semitone. */
function maxBendSemitones(note: alphaTab.model.Note): number {
  const points = note.bendPoints;
  if (!points || points.length === 0) return 0;
  let max = 0;
  for (const p of points) max = Math.max(max, p.value);
  return max / 2;
}

function techniquesOf(note: alphaTab.model.Note): Techniques {
  return Object.freeze({
    bend: maxBendSemitones(note),
    slide: slideKind(note),
    hammerPull: note.isHammerPullOrigin ? 'origin' : note.isHammerPullDestination ? 'destination' : 'none',
    palmMute: note.isPalmMute,
    harmonic: note.harmonicType !== alphaTab.model.HarmonicType.None,
    dead: note.isDead,
    ghost: note.isGhost,
    letRing: note.isLetRing,
    vibrato: note.vibrato !== alphaTab.model.VibratoType.None,
    tied: note.isTieDestination,
  });
}

function trackInfo(track: alphaTab.model.Track, hasTabData: boolean): TrackInfo {
  const staff = track.staves[0];
  // alphaTab already lists the tuning highest string first, as printed tab does. A staff without
  // a tuning (notation-only MusicXML) gets standard guitar tuning.
  const own = staff ? [...staff.tuning] : [];
  const tuning = own.length > 0 ? own : [...STANDARD_TUNING];
  return Object.freeze({
    index: track.index,
    name: track.name,
    stringCount: tuning.length,
    tuning: Object.freeze(tuning),
    hasTabData,
    isPercussion: track.isPercussion,
  });
}

/** True when every note in the track has an explicit string and fret in the file. */
function trackHasTabData(track: alphaTab.model.Track): boolean {
  let sawNote = false;
  for (const staff of track.staves) {
    for (const bar of staff.bars) {
      for (const voice of bar.voices) {
        for (const beat of voice.beats) {
          for (const note of beat.notes) {
            sawNote = true;
            if (note.string < 1 || note.fret < 0) return false;
          }
        }
      }
    }
  }
  return sawNote;
}

const MAX_FRET = 24;

/**
 * Places a pitch on the guitar when the file gives no string and fret: the string that needs the
 * lowest fret, preferring the higher string on a tie. Returns null when no string reaches the pitch.
 */
export function assignFret(tuning: readonly number[], pitch: number): { string: number; fret: number } | null {
  let best: { string: number; fret: number } | null = null;
  tuning.forEach((open, i) => {
    const fret = pitch - open;
    if (fret < 0 || fret > MAX_FRET) return;
    if (!best || fret < best.fret) best = { string: i + 1, fret };
  });
  return best;
}

/**
 * Builds our immutable Timeline from an alphaTab score, using alphaTab's own tick lookup so
 * playback order, repeats and tempo changes match what alphaTab plays.
 */
export function buildTimeline(score: alphaTab.model.Score): Timeline {
  const settings = new alphaTab.Settings();
  const handler = new alphaTab.midi.AlphaSynthMidiFileHandler(new alphaTab.midi.MidiFile());
  const generator = new alphaTab.midi.MidiFileGenerator(score, settings, handler);
  generator.generate();

  const lookupBars = generator.tickLookup.masterBars;
  const tempoMap: TempoPoint[] = [];
  for (const bar of lookupBars) {
    for (const change of bar.tempoChanges) {
      const last = tempoMap[tempoMap.length - 1];
      if (!last || last.tick !== change.tick || last.tempo !== change.tempo) {
        tempoMap.push(Object.freeze({ tick: change.tick, tempo: change.tempo }));
      }
    }
  }
  tempoMap.sort((a, b) => a.tick - b.tick);

  const tracks: TrackInfo[] = score.tracks.map((t) => trackInfo(t, trackHasTabData(t)));
  const notesByTrack = new Map<number, NoteEvent[]>(tracks.map((t) => [t.index, []]));
  const bars: BarEvent[] = [];

  lookupBars.forEach((lookupBar, playbackIndex) => {
    const masterBar = lookupBar.masterBar;
    bars.push(
      Object.freeze({
        playbackIndex,
        scoreBar: masterBar.index,
        startSeconds: ticksToSeconds(tempoMap, lookupBar.start),
        endSeconds: ticksToSeconds(tempoMap, lookupBar.end),
        startTick: lookupBar.start,
        endTick: lookupBar.end,
        tempo: lookupBar.tempoChanges[0]?.tempo ?? 120,
        timeSignature: Object.freeze({
          numerator: masterBar.timeSignatureNumerator,
          denominator: masterBar.timeSignatureDenominator,
        }),
      }),
    );

    for (let slice = lookupBar.firstBeat; slice; slice = slice.nextBeat) {
      const tick = lookupBar.start + slice.start;
      for (const item of slice.highlightedBeats) {
        if (item.playbackStart !== slice.start) continue;
        const beat = item.beat;
        const track = beat.voice.bar.staff.track;
        const list = notesByTrack.get(track.index);
        const info = tracks[track.index];
        if (!list || !info || info.isPercussion) continue;
        const durationTicks = beat.playbackDuration;
        const startSeconds = ticksToSeconds(tempoMap, tick);
        const endSeconds = ticksToSeconds(tempoMap, tick + durationTicks);
        for (const note of beat.notes) {
          let string: number;
          let fret: number;
          if (note.string >= 1 && note.fret >= 0) {
            // alphaTab numbers strings from the lowest-pitched one; our model starts at the highest.
            string = info.stringCount - note.string + 1;
            fret = note.fret;
          } else {
            const placed = assignFret(info.tuning, note.realValue);
            if (!placed) continue;
            ({ string, fret } = placed);
          }
          list.push(
            Object.freeze({
              id: `${track.index}:${playbackIndex}:${tick}:${string}`,
              trackIndex: track.index,
              string,
              fret,
              tick,
              durationTicks,
              startSeconds,
              endSeconds,
              playbackBar: playbackIndex,
              scoreBar: masterBar.index,
              techniques: techniquesOf(note),
            }),
          );
        }
      }
    }
  });

  for (const list of notesByTrack.values()) {
    list.sort((a, b) => a.startSeconds - b.startSeconds || a.string - b.string);
    Object.freeze(list);
  }

  const last = lookupBars[lookupBars.length - 1];
  const durationSeconds = last ? ticksToSeconds(tempoMap, last.end) : 0;

  return Object.freeze({
    title: score.title,
    artist: score.artist,
    tracks: Object.freeze(tracks),
    bars: Object.freeze(bars),
    tempoMap: Object.freeze(tempoMap),
    durationSeconds,
    scoreBarCount: score.masterBars.length,
    notesForTrack(trackIndex: number): readonly NoteEvent[] {
      return notesByTrack.get(trackIndex) ?? [];
    },
  });
}
