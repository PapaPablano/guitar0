import * as alphaTab from '@coderline/alphatab';

/** One played beat, in playback order (repeats appear once per pass). */
export interface SpikeBeat {
  /** Index of the played bar in playback order, counting repeats. */
  playbackBar: number;
  /** Bar index in the score (score order). */
  scoreBar: number;
  /** Absolute midi tick at which the beat starts. */
  tick: number;
  /** Seconds from the start of playback, from the tempo map. */
  seconds: number;
  /** Tempo in effect at the beat. */
  tempo: number;
  /** "string/fret" per note. */
  notes: string[];
}

interface TempoPoint {
  tick: number;
  tempo: number;
}

const TICKS_PER_QUARTER = 960;

/** Converts an absolute tick to seconds through a tempo map sorted by tick. */
export function ticksToSeconds(points: TempoPoint[], tick: number): number {
  let seconds = 0;
  for (let i = 0; i < points.length; i++) {
    const start = points[i].tick;
    if (tick <= start) break;
    const end = i + 1 < points.length ? Math.min(points[i + 1].tick, tick) : tick;
    seconds += ((end - start) / TICKS_PER_QUARTER) * (60 / points[i].tempo);
  }
  return seconds;
}

export function loadScoreFromBytes(data: Uint8Array): alphaTab.model.Score {
  return alphaTab.importer.ScoreLoader.loadScoreFromBytes(data, new alphaTab.Settings());
}

export function loadAlphaTex(tex: string): alphaTab.model.Score {
  return alphaTab.importer.ScoreLoader.loadAlphaTex(tex, new alphaTab.Settings());
}

/** Dumps every played beat with its tick, seconds and notes, using alphaTab's own tick lookup. */
export function dumpTimeline(score: alphaTab.model.Score, trackIndex = 0): SpikeBeat[] {
  const settings = new alphaTab.Settings();
  const handler = new alphaTab.midi.AlphaSynthMidiFileHandler(new alphaTab.midi.MidiFile());
  const generator = new alphaTab.midi.MidiFileGenerator(score, settings, handler);
  generator.generate();

  const bars = generator.tickLookup.masterBars;
  const tempoMap: TempoPoint[] = [];
  for (const bar of bars) {
    for (const change of bar.tempoChanges) {
      const last = tempoMap[tempoMap.length - 1];
      if (!last || last.tick !== change.tick || last.tempo !== change.tempo) {
        tempoMap.push({ tick: change.tick, tempo: change.tempo });
      }
    }
  }
  tempoMap.sort((a, b) => a.tick - b.tick);

  const beats: SpikeBeat[] = [];
  bars.forEach((bar, playbackBar) => {
    for (let slice = bar.firstBeat; slice; slice = slice.nextBeat) {
      const tick = bar.start + slice.start;
      for (const item of slice.highlightedBeats) {
        const beat = item.beat;
        if (beat.voice.bar.staff.track.index !== trackIndex || item.playbackStart !== slice.start) continue;
        const tempo = tempoAt(tempoMap, tick);
        beats.push({
          playbackBar,
          scoreBar: bar.masterBar.index,
          tick,
          seconds: ticksToSeconds(tempoMap, tick),
          tempo,
          notes: beat.notes.map((n) => `${n.string}/${n.fret}`),
        });
      }
    }
  });
  return beats;
}

function tempoAt(points: TempoPoint[], tick: number): number {
  let tempo = points[0]?.tempo ?? 120;
  for (const p of points) {
    if (p.tick <= tick) tempo = p.tempo;
  }
  return tempo;
}
