/**
 * Synthetic audio for the alignment tests. A "song" is a list of notes; it can be rendered in a plain or
 * a rich timbre (harmonics and noise, standing in for a real recording), shifted, and have unrelated
 * material inserted, which is how the tests build a known offset and a known extra section.
 */

export interface SongNote {
  /** Seconds from the start of the song. */
  readonly start: number;
  readonly duration: number;
  readonly midi: number;
}

export type Timbre = 'plain' | 'rich';

/** A small deterministic random source so fixtures are the same on every run. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export const midiToHz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

/**
 * A song of `bars` bars, `barSeconds` long each, with a distinct three-note chord and a melody note per
 * bar so no stretch of it repeats. `seed` makes another song.
 */
export function songNotes(bars: number, barSeconds = 2, seed = 7): SongNote[] {
  const random = seeded(seed);
  const notes: SongNote[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const root = 40 + Math.floor(random() * 12);
    const third = root + (random() < 0.5 ? 3 : 4);
    const fifth = root + 7;
    const start = bar * barSeconds;
    for (const midi of [root, third, fifth]) notes.push({ start, duration: barSeconds * 0.95, midi: midi + 12 });
    const melody = 64 + Math.floor(random() * 12);
    notes.push({ start: start + barSeconds / 2, duration: barSeconds * 0.45, midi: melody });
  }
  return notes;
}

/** Renders notes to mono samples. */
export function renderSong(notes: readonly SongNote[], seconds: number, rate: number, timbre: Timbre = 'plain', seed = 3): Float32Array {
  const out = new Float32Array(Math.ceil(seconds * rate));
  const random = seeded(seed);
  const partials = timbre === 'rich' ? [1, 0.5, 0.33, 0.25] : [1];
  for (const note of notes) {
    const from = Math.floor(note.start * rate);
    const to = Math.min(out.length, Math.floor((note.start + note.duration) * rate));
    const hz = midiToHz(note.midi);
    for (let i = from; i < to; i++) {
      const t = (i - from) / rate;
      const attack = Math.min(1, t / 0.005);
      const release = Math.min(1, (note.start + note.duration - i / rate) / 0.02);
      const envelope = attack * Math.max(0, release) * (timbre === 'rich' ? Math.exp(-t * 1.2) * 0.6 + 0.4 : 1);
      let sample = 0;
      for (let p = 0; p < partials.length; p++) sample += partials[p] * Math.sin(2 * Math.PI * hz * (p + 1) * t);
      out[i] += 0.12 * envelope * sample;
    }
  }
  if (timbre === 'rich') for (let i = 0; i < out.length; i++) out[i] += (random() - 0.5) * 0.01;
  return out;
}

/** A sine tone. */
export function tone(hz: number, seconds: number, rate: number, amplitude = 0.5): Float32Array {
  const out = new Float32Array(Math.ceil(seconds * rate));
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / rate);
  return out;
}

export function silence(seconds: number, rate: number): Float32Array {
  return new Float32Array(Math.ceil(seconds * rate));
}

export function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((sum, p) => sum + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Puts `lead` seconds of silence before the samples; a negative `lead` cuts that much off the start. */
export function shifted(samples: Float32Array, leadSeconds: number, rate: number): Float32Array {
  const frames = Math.round(Math.abs(leadSeconds) * rate);
  return leadSeconds >= 0 ? concat(new Float32Array(frames), samples) : samples.slice(frames);
}

/** Inserts `extra` into the samples at `atSeconds`, so everything after it comes later by the extra's length. */
export function inserted(samples: Float32Array, atSeconds: number, extra: Float32Array, rate: number): Float32Array {
  const at = Math.round(atSeconds * rate);
  return concat(samples.subarray(0, at), extra, samples.subarray(at));
}

/** Removes `seconds` of samples starting at `atSeconds`, so everything after it comes earlier (the recording skips bars). */
export function removed(samples: Float32Array, atSeconds: number, seconds: number, rate: number): Float32Array {
  const at = Math.round(atSeconds * rate);
  return concat(samples.subarray(0, at), samples.subarray(at + Math.round(seconds * rate)));
}

/** Material that is musical but unrelated to a given song: another seed, in the rich timbre. */
export function unrelatedMusic(seconds: number, rate: number, seed = 991): Float32Array {
  const bars = Math.ceil(seconds / 2);
  return renderSong(songNotes(bars, 2, seed), seconds, rate, 'rich', seed);
}

export function noise(seconds: number, rate: number, seed = 5, amplitude = 0.2): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(Math.ceil(seconds * rate));
  for (let i = 0; i < out.length; i++) out[i] = (random() - 0.5) * 2 * amplitude;
  return out;
}

/** A played bar of the tab, in tab seconds. */
export interface BarShape {
  readonly start: number;
  readonly end: number;
}

/** `count` bars of `barSeconds` each, back to back from `from`. */
export function barSpans(count: number, barSeconds = 2, from = 0): BarShape[] {
  return Array.from({ length: count }, (_, i) => ({ start: from + i * barSeconds, end: from + (i + 1) * barSeconds }));
}

/** A band's performance of a song, with the true anchor of every bar known by construction. */
export interface Performance {
  readonly notes: SongNote[];
  /** Length of the recording in seconds, lead-in included. */
  readonly seconds: number;
  /** The recording second at which each bar starts. */
  readonly anchors: number[];
  /** The recording second at which the tab ends. */
  readonly endAnchor: number;
}

/**
 * Plays the song's bars for the given recorded lengths. A bar recorded shorter than the tab's is played faster; a
 * bar recorded longer is played steadily and followed by unrelated playing for the rest of its time (extra
 * playing); a bar recorded at zero length is skipped, its notes dropped.
 */
export function bandPerformance(notes: readonly SongNote[], bars: readonly BarShape[], recordedLengths: readonly number[], lead = 0, extraSeed = 4242): Performance {
  const out: SongNote[] = [];
  const anchors: number[] = [];
  let at = lead;
  bars.forEach((bar, k) => {
    const recorded = recordedLengths[k];
    const duration = bar.end - bar.start;
    anchors.push(at);
    if (recorded > 0) {
      // A second or more over is extra playing after steady notes; any other difference is the whole bar played slower or faster.
      const extraPlaying = recorded - duration >= 1;
      const scale = extraPlaying ? 1 : recorded / duration;
      for (const n of notes) {
        if (n.start < bar.start || n.start >= bar.end) continue;
        out.push({ start: at + (n.start - bar.start) * scale, duration: n.duration * scale, midi: n.midi });
      }
      if (extraPlaying) {
        const extra = songNotes(Math.ceil((recorded - duration) / 2), 2, extraSeed + k);
        for (const n of extra) {
          if (n.start >= recorded - duration) continue;
          out.push({ start: at + duration + n.start, duration: Math.min(n.duration, recorded - duration - n.start), midi: n.midi });
        }
      }
    }
    at += Math.max(0, recorded);
  });
  return { notes: out, seconds: at + 0.5, anchors, endAnchor: at };
}

/**
 * A song made of sections: each distinct letter of `order` has its own four-bar loop, played over and over for
 * `barsPerSection` bars, and a letter that comes again plays the same loop again, so repeats are exact.
 */
export function structuredSong(order: string, barsPerSection = 8, barSeconds = 2, seed = 100): SongNote[] {
  const loops = new Map<string, SongNote[]>();
  const notes: SongNote[] = [];
  [...order].forEach((letter, index) => {
    if (!loops.has(letter)) loops.set(letter, songNotes(4, barSeconds, seed + loops.size * 17));
    const offset = index * barsPerSection * barSeconds;
    for (let bar = 0; bar < barsPerSection; bar++) {
      for (const n of loops.get(letter)!) {
        if (Math.floor(n.start / barSeconds) !== bar % 4) continue;
        notes.push({ ...n, start: offset + bar * barSeconds + (n.start - (bar % 4) * barSeconds) });
      }
    }
  });
  return notes;
}
