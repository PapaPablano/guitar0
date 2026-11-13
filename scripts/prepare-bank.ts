/**
 * Dev-only: turns one SF2 guitar or bass bank into a small SF3 file that alphaTab 1.8.4 plays and the bank filter keeps
 * (plan U4, KTD2, KTD3). Not shipped, not run by the app.
 *
 *   node scripts/prepare-bank.ts <in.sf2> <out.sf3> --program 30 [--name "Distortion Guitar"] [--preset 0]
 *        [--max-seconds 8] [--fade-ms 50] [--quality 4] [--velocities all|alphatab|7,15,...] [--extend-keys] [--ffmpeg path]
 *
 * What it does, in order:
 *  1. Keeps one preset (`--preset`, an index into the file's presets) and only the instruments and samples it reaches, and
 *     moves it to bank 0 at `--program`, optionally renamed.
 *  2. Folds stereo pairs to mono. alphaTab plays a left or right sample as silence, so a pair becomes one mono sample,
 *     (L + R) / 2, which is exact for the dual-mono pairs FreePats ships and a plain fold-down otherwise (the lowest L/R
 *     correlation is printed so a wide pair is noticed). Zones that pointed at either half now point at the mono sample
 *     with their pan removed, and the duplicate zone that remains is dropped, so each note sounds once, centred.
 *  3. With `--velocities`, keeps only the takes those velocities select. A zone whose velocity range holds none of them is
 *     re-pointed to the sample of the nearest zone that does, in the same key slot, so every velocity still sounds; zones
 *     left playing the same sample are merged. `alphatab` is every velocity alphaTab's MIDI generator writes for ppp to fff
 *     and pf, with accent, ghost, hammer-on and ornament adjustments: 7, 15, 23 ... 127 (15 + 16k and 87 + 16k). Rarer
 *     pppp-and-below velocities (1, 3, 5, 10 and their adjustments) then play the nearest kept take.
 *  4. With `--extend-keys`, stretches the outermost zones to keys 0 and 127 (see `extendKeys`).
 *  5. Trims each sample to `--max-seconds`, fading the last `--fade-ms`. A sample that a zone loops (sampleModes 1 or 3)
 *     keeps everything up to its loop end, and the fade never enters the loop.
 *  6. Encodes each sample to Ogg Vorbis with ffmpeg and writes SF3 the way alphaTab reads it (see `writeSf3`).
 *
 * Node runs this file directly (it strips the types). The exported functions are pure and covered by
 * `tests/scripts/prepare-bank.test.ts`; only `main` touches the disk and ffmpeg.
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

// ---- Model ----

export interface Generator {
  readonly op: number;
  /** The raw 16-bit amount; key and velocity ranges hold low in the low byte, high in the high byte. */
  readonly amount: number;
}

export interface Zone {
  readonly gens: readonly Generator[];
  /** The zone's modulators, 10 raw bytes each, copied as they are. */
  readonly mods: Uint8Array;
}

export interface Sf2Preset {
  readonly name: string;
  readonly program: number;
  readonly bank: number;
  readonly zones: readonly Zone[];
}

export interface Sf2Instrument {
  readonly name: string;
  readonly zones: readonly Zone[];
}

/** An SF2 sample header, with start, end and loop points in frames from the start of `smpl`. */
export interface Sf2Sample {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  readonly loopStart: number;
  readonly loopEnd: number;
  readonly rate: number;
  readonly pitch: number;
  readonly correction: number;
  readonly link: number;
  readonly type: number;
}

export interface Sf2Bank {
  /** INFO sub-chunks in file order. */
  readonly info: readonly { readonly id: string; readonly data: Uint8Array }[];
  /** The `smpl` chunk: 16-bit little-endian PCM. */
  readonly smpl: Uint8Array;
  readonly presets: readonly Sf2Preset[];
  readonly instruments: readonly Sf2Instrument[];
  readonly samples: readonly Sf2Sample[];
}

/** One mono sample of the prepared bank, made from one SF2 sample or a left and right pair. */
export interface MonoSample {
  readonly name: string;
  readonly rate: number;
  readonly pitch: number;
  readonly correction: number;
  /** The SF2 sample(s) it comes from; two when it is a folded stereo pair. */
  readonly sources: readonly Sf2Sample[];
  /** Length and loop points in frames from the sample's own start. */
  readonly frames: number;
  readonly loopStart: number;
  readonly loopEnd: number;
}

/** A bank on its way to SF3: one preset, its instruments, mono samples (zones' sample IDs index `samples`). */
export interface Prepared {
  readonly info: Sf2Bank['info'];
  readonly smpl: Uint8Array;
  readonly preset: Sf2Preset;
  readonly instruments: readonly Sf2Instrument[];
  readonly samples: readonly MonoSample[];
}

export const GEN = {
  startAddrsOffset: 0,
  endAddrsOffset: 1,
  startAddrsCoarseOffset: 4,
  endAddrsCoarseOffset: 12,
  pan: 17,
  instrument: 41,
  keyRange: 43,
  velRange: 44,
  sampleId: 53,
  sampleModes: 54,
} as const;

export const SAMPLE_TYPE = { mono: 1, right: 2, left: 4, linked: 8, ogg: 0x10 } as const;

// ---- Reading SF2 ----

const PHDR = 38;
const PBAG = 4;
const PMOD = 10;
const PGEN = 4;
const INST = 22;
const IBAG = 4;
const IGEN = 4;
const SHDR = 46;

function tag(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
}

function name20(bytes: Uint8Array, at: number): string {
  let s = '';
  for (let i = 0; i < 20 && bytes[at + i] !== 0; i++) s += String.fromCharCode(bytes[at + i]);
  return s;
}

/** Reads an uncompressed SF2 bank. Throws on anything it cannot use, with a message for the person running the script. */
export function parseSf2(bytes: Uint8Array): Sf2Bank {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12 || tag(bytes, 0) !== 'RIFF' || tag(bytes, 8) !== 'sfbk') throw new Error('not an SF2 file');
  const lists = new Map<string, Map<string, Uint8Array>>();
  const infoOrder: { id: string; data: Uint8Array }[] = [];
  const end = Math.min(bytes.length, dv.getUint32(4, true) + 8);
  for (let at = 12; at + 8 <= end; ) {
    const size = dv.getUint32(at + 4, true);
    if (tag(bytes, at) === 'LIST') {
      const type = tag(bytes, at + 8);
      const subs = new Map<string, Uint8Array>();
      for (let sub = at + 12; sub + 8 <= at + 8 + size; ) {
        const subSize = dv.getUint32(sub + 4, true);
        const data = bytes.subarray(sub + 8, sub + 8 + subSize);
        subs.set(tag(bytes, sub), data);
        if (type === 'INFO') infoOrder.push({ id: tag(bytes, sub), data });
        sub += 8 + subSize + (subSize % 2);
      }
      lists.set(type, subs);
    }
    at += 8 + size + (size % 2);
  }
  const pdta = lists.get('pdta');
  const smpl = lists.get('sdta')?.get('smpl');
  if (!pdta || !smpl) throw new Error('the file has no preset data or no samples');
  const get = (id: string, record: number) => {
    const body = pdta.get(id);
    if (!body || body.length % record !== 0 || body.length < record) throw new Error(`the ${id} chunk is missing or damaged`);
    return { body, dv: new DataView(body.buffer, body.byteOffset, body.byteLength), count: body.length / record };
  };
  const phdr = get('phdr', PHDR);
  const pbag = get('pbag', PBAG);
  const pmod = get('pmod', PMOD);
  const pgen = get('pgen', PGEN);
  const inst = get('inst', INST);
  const ibag = get('ibag', IBAG);
  const imod = get('imod', PMOD);
  const igen = get('igen', IGEN);
  const shdr = get('shdr', SHDR);

  const zones = (bag: typeof pbag, gen: typeof pgen, mod: typeof pmod, from: number, to: number): Zone[] => {
    const out: Zone[] = [];
    for (let b = from; b < to; b++) {
      const g0 = bag.dv.getUint16(b * 4, true);
      const g1 = bag.dv.getUint16(b * 4 + 4, true);
      const m0 = bag.dv.getUint16(b * 4 + 2, true);
      const m1 = bag.dv.getUint16(b * 4 + 6, true);
      const gens: Generator[] = [];
      for (let g = g0; g < g1; g++) gens.push({ op: gen.dv.getUint16(g * 4, true), amount: gen.dv.getUint16(g * 4 + 2, true) });
      out.push({ gens, mods: mod.body.slice(m0 * PMOD, m1 * PMOD) });
    }
    return out;
  };

  const presets: Sf2Preset[] = [];
  for (let p = 0; p + 1 < phdr.count; p++) {
    const at = p * PHDR;
    presets.push({
      name: name20(phdr.body, at),
      program: phdr.dv.getUint16(at + 20, true),
      bank: phdr.dv.getUint16(at + 22, true),
      zones: zones(pbag, pgen, pmod, phdr.dv.getUint16(at + 24, true), phdr.dv.getUint16(at + PHDR + 24, true)),
    });
  }
  const instruments: Sf2Instrument[] = [];
  for (let i = 0; i + 1 < inst.count; i++) {
    const at = i * INST;
    instruments.push({
      name: name20(inst.body, at),
      zones: zones(ibag, igen, imod, inst.dv.getUint16(at + 20, true), inst.dv.getUint16(at + INST + 20, true)),
    });
  }
  const samples: Sf2Sample[] = [];
  for (let s = 0; s + 1 < shdr.count; s++) {
    const at = s * SHDR;
    const d = shdr.dv;
    samples.push({
      name: name20(shdr.body, at),
      start: d.getUint32(at + 20, true),
      end: d.getUint32(at + 24, true),
      loopStart: d.getUint32(at + 28, true),
      loopEnd: d.getUint32(at + 32, true),
      rate: d.getUint32(at + 36, true),
      pitch: shdr.body[at + 40],
      correction: d.getInt8(at + 41),
      link: d.getUint16(at + 42, true),
      type: d.getUint16(at + 44, true),
    });
  }
  return { info: infoOrder, smpl, presets, instruments, samples };
}

// ---- Steps ----

const sampleIdOf = (zone: Zone) => zone.gens.find((g) => g.op === GEN.sampleId)?.amount;
const withGens = (zone: Zone, gens: readonly Generator[]): Zone => ({ gens, mods: zone.mods });
const rangeOf = (zone: Zone, op: number): [number, number] => {
  const g = zone.gens.find((x) => x.op === op);
  return g ? [g.amount & 0xff, g.amount >> 8] : [0, 127];
};

/**
 * Step 1 and 2: the one preset, moved to bank 0 at `program`, with stereo pairs folded to mono samples. Sample data is not
 * touched yet: each mono sample records the SF2 sample(s) it is mixed from.
 */
export function selectAndFold(bank: Sf2Bank, options: { preset: number; program: number; name?: string }): Prepared {
  const source = bank.presets[options.preset];
  if (!source) throw new Error(`the file has no preset ${options.preset} (it has ${bank.presets.length})`);
  if (!Number.isInteger(options.program) || options.program < 0 || options.program > 127) throw new Error('the program must be 0 to 127');

  const instrumentIndex = new Map<number, number>();
  const instruments: Sf2Instrument[] = [];
  const monoIndex = new Map<number, number>();
  const samples: MonoSample[] = [];

  const monoFor = (s: number): number => {
    const known = monoIndex.get(s);
    if (known !== undefined) return known;
    const sample = bank.samples[s];
    if (!sample) throw new Error(`a zone names sample ${s}, which does not exist`);
    const base = sample.type & ~SAMPLE_TYPE.ogg;
    if (sample.type & SAMPLE_TYPE.ogg) throw new Error('the input is already compressed (SF3); give the SF2 original');
    if (base !== SAMPLE_TYPE.mono && base !== SAMPLE_TYPE.left && base !== SAMPLE_TYPE.right) {
      throw new Error(`sample "${sample.name}" has type ${sample.type} (linked or ROM), which this script does not handle`);
    }
    const partner = bank.samples[sample.link];
    const paired =
      base !== SAMPLE_TYPE.mono &&
      partner !== undefined &&
      (partner.type & ~SAMPLE_TYPE.ogg) === (base === SAMPLE_TYPE.left ? SAMPLE_TYPE.right : SAMPLE_TYPE.left) &&
      partner.link === s &&
      partner.rate === sample.rate &&
      partner.end - partner.start === sample.end - sample.start;
    const left = paired && base === SAMPLE_TYPE.right ? partner : sample;
    const sources = paired ? [left, left === sample ? partner : sample] : [sample];
    const index = samples.length;
    samples.push({
      name: paired ? left.name.replace(/[_ -]?L$/i, '').slice(0, 19) || left.name : sample.name,
      rate: left.rate,
      pitch: left.pitch,
      correction: left.correction,
      sources,
      frames: left.end - left.start,
      loopStart: Math.max(0, left.loopStart - left.start),
      loopEnd: Math.max(0, left.loopEnd - left.start),
    });
    monoIndex.set(s, index);
    if (paired) monoIndex.set(sample.link, index);
    return index;
  };

  const instrumentFor = (i: number): number => {
    const known = instrumentIndex.get(i);
    if (known !== undefined) return known;
    const instrument = bank.instruments[i];
    if (!instrument) throw new Error(`the preset names instrument ${i}, which does not exist`);
    const index = instruments.length;
    instrumentIndex.set(i, index);
    instruments.push(instrument); // replaced below once its zones are rewritten
    const seen = new Set<string>();
    const zones: Zone[] = [];
    for (const zone of instrument.zones) {
      for (const op of [GEN.startAddrsOffset, GEN.endAddrsOffset, GEN.startAddrsCoarseOffset, GEN.endAddrsCoarseOffset]) {
        // alphaTab decodes a compressed sample whole and ignores these, so they would change how the bank plays.
        if (zone.gens.some((g) => g.op === op)) throw new Error(`instrument "${instrument.name}" uses sample offset generator ${op}`);
      }
      const s = sampleIdOf(zone);
      if (s === undefined) {
        zones.push(zone);
        continue;
      }
      const stereo = (bank.samples[s]?.type ?? 0) & (SAMPLE_TYPE.left | SAMPLE_TYPE.right);
      const mono = monoFor(s);
      const gens = zone.gens
        .filter((g) => !(stereo && g.op === GEN.pan))
        .map((g) => (g.op === GEN.sampleId ? { op: g.op, amount: mono } : g));
      // The other half of a folded pair now reads the same: keep the first, so the note sounds once. Mono zones are kept
      // as they are, even when two are alike, since a bank may layer one sample on purpose.
      const key = JSON.stringify(gens) + Array.from(zone.mods).join(',');
      if (stereo && seen.has(key)) continue;
      if (stereo) seen.add(key);
      zones.push(withGens(zone, gens));
    }
    instruments[index] = { name: instrument.name, zones };
    return index;
  };

  const presetZones = source.zones.map((zone) =>
    withGens(
      zone,
      zone.gens.map((g) => (g.op === GEN.instrument ? { op: g.op, amount: instrumentFor(g.amount) } : g)),
    ),
  );
  return {
    info: bank.info,
    smpl: bank.smpl,
    preset: { name: (options.name ?? source.name).slice(0, 19), program: options.program, bank: 0, zones: presetZones },
    instruments,
    samples,
  };
}

/** Every velocity alphaTab 1.8.4's MIDI generator writes for ppp to fff and pf, with its +-16 adjustments: 7, 15 ... 127. */
export const ALPHATAB_VELOCITIES: readonly number[] = Array.from({ length: 16 }, (_, k) => 7 + 8 * k);

/** The gens that place a zone in a key slot: everything but the velocity range and the sample. */
const slotKey = (zone: Zone) =>
  JSON.stringify(zone.gens.filter((g) => g.op !== GEN.velRange && g.op !== GEN.sampleId)) + Array.from(zone.mods).join(',');

const gap = (a: [number, number], b: [number, number]) => (a[1] < b[0] ? b[0] - a[1] : b[1] < a[0] ? a[0] - b[1] : 0);

/**
 * Step 3: keeps only the takes the given velocities select. Every zone still sounds; zones whose velocity range holds no
 * kept velocity play the sample of the nearest one that does in the same key slot. Samples no zone plays are dropped.
 */
export function pruneVelocities(bank: Prepared, velocities: readonly number[]): Prepared {
  const keep = new Set(velocities);
  const holdsKept = (zone: Zone) => {
    const [lo, hi] = rangeOf(zone, GEN.velRange);
    for (let v = lo; v <= hi; v++) if (keep.has(v)) return true;
    return false;
  };
  const instruments = bank.instruments.map((instrument) => {
    const slots = new Map<string, Zone[]>();
    for (const zone of instrument.zones) {
      if (sampleIdOf(zone) === undefined) continue;
      const key = slotKey(zone);
      slots.set(key, [...(slots.get(key) ?? []), zone]);
    }
    const repointed = instrument.zones.map((zone) => {
      if (sampleIdOf(zone) === undefined || holdsKept(zone)) return zone;
      const vel = rangeOf(zone, GEN.velRange);
      let best: Zone | undefined;
      for (const other of slots.get(slotKey(zone))!) {
        if (!holdsKept(other)) continue;
        if (!best || gap(vel, rangeOf(other, GEN.velRange)) < gap(vel, rangeOf(best, GEN.velRange))) best = other;
      }
      if (!best) return zone; // no kept take in this slot: leave it as it is
      const s = sampleIdOf(best)!;
      return withGens(zone, zone.gens.map((g) => (g.op === GEN.sampleId ? { op: g.op, amount: s } : g)));
    });
    return { name: instrument.name, zones: mergeVelocityRuns(repointed) };
  });
  return dropUnused({ ...bank, instruments });
}

/** Zones that differ only in velocity range and now play the same sample become one zone per contiguous velocity run. */
function mergeVelocityRuns(zones: readonly Zone[]): Zone[] {
  const groups = new Map<string, Zone[]>();
  const out: (Zone | string)[] = [];
  for (const zone of zones) {
    if (sampleIdOf(zone) === undefined) {
      out.push(zone);
      continue;
    }
    const key = slotKey(zone) + '#' + sampleIdOf(zone);
    if (!groups.has(key)) {
      groups.set(key, []);
      out.push(key);
    }
    groups.get(key)!.push(zone);
  }
  return out.flatMap((entry) => {
    if (typeof entry !== 'string') return [entry];
    const group = groups.get(entry)!;
    if (!group[0].gens.some((g) => g.op === GEN.velRange)) return group;
    const ranges = group.map((z) => rangeOf(z, GEN.velRange)).sort((a, b) => a[0] - b[0]);
    const runs: [number, number][] = [];
    for (const r of ranges) {
      const last = runs[runs.length - 1];
      if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
      else runs.push([r[0], r[1]]);
    }
    return runs.map(([lo, hi]) =>
      withGens(group[0], group[0].gens.map((g) => (g.op === GEN.velRange ? { op: g.op, amount: lo | (hi << 8) } : g))),
    );
  });
}

/** Drops samples no zone plays and renumbers the rest. */
function dropUnused(bank: Prepared): Prepared {
  const used = new Set<number>();
  for (const i of bank.instruments) for (const z of i.zones) if (sampleIdOf(z) !== undefined) used.add(sampleIdOf(z)!);
  const renumber = new Map<number, number>();
  const samples = bank.samples.filter((_, s) => used.has(s));
  [...used].sort((a, b) => a - b).forEach((s, i) => renumber.set(s, i));
  const instruments = bank.instruments.map((i) => ({
    name: i.name,
    zones: i.zones.map((z) =>
      withGens(z, z.gens.map((g) => (g.op === GEN.sampleId ? { op: g.op, amount: renumber.get(g.amount)! } : g))),
    ),
  }));
  return { ...bank, instruments, samples };
}

/**
 * With `--extend-keys`: the preset plays every key, and each instrument's lowest and highest zones stretch to keys 0 and
 * 127, so a note outside the sampled range plays the nearest sample pitched instead of nothing. alphaTab takes a program's
 * sound from the last bank that has it and never falls back to a lower bank per key, so without this a bass bank sampled to
 * A2 is silent above it.
 */
export function extendKeys(bank: Prepared): Prepared {
  const setRange = (zone: Zone, lo: number, hi: number) =>
    withGens(zone, zone.gens.map((g) => (g.op === GEN.keyRange ? { op: g.op, amount: lo | (hi << 8) } : g)));
  const playing = bank.preset.zones.filter((z) => z.gens.some((g) => g.op === GEN.instrument));
  // Two instruments split across the keys would overlap once both are stretched.
  if (playing.length !== 1) throw new Error('--extend-keys needs a preset that plays one instrument');
  const preset = { ...bank.preset, zones: bank.preset.zones.map((z) => (z === playing[0] ? setRange(z, 0, 127) : z)) };
  const instruments = bank.instruments.map((instrument) => {
    const ranges = instrument.zones.filter((z) => sampleIdOf(z) !== undefined).map((z) => rangeOf(z, GEN.keyRange));
    const lowest = Math.min(...ranges.map((r) => r[0]));
    const highest = Math.max(...ranges.map((r) => r[1]));
    const zones = instrument.zones.map((z) => {
      if (sampleIdOf(z) === undefined) return z;
      const [lo, hi] = rangeOf(z, GEN.keyRange);
      return lo === lowest || hi === highest ? setRange(z, lo === lowest ? 0 : lo, hi === highest ? 127 : hi) : z;
    });
    return { name: instrument.name, zones };
  });
  return { ...bank, preset, instruments };
}

/** Indices of samples that some zone loops (sampleModes 1 or 3, from the zone or its instrument's global zone). */
export function loopedSamples(bank: Prepared): Set<number> {
  const looped = new Set<number>();
  for (const instrument of bank.instruments) {
    const first = instrument.zones[0];
    const global = first && sampleIdOf(first) === undefined ? first : undefined;
    const globalMode = global?.gens.find((g) => g.op === GEN.sampleModes)?.amount ?? 0;
    for (const zone of instrument.zones) {
      const s = sampleIdOf(zone);
      if (s === undefined) continue;
      const mode = zone.gens.find((g) => g.op === GEN.sampleModes)?.amount ?? globalMode;
      if (mode & 1) looped.add(s);
    }
  }
  return looped;
}

/** Step 4: the frame count each sample keeps, and where its fade starts (equal to the length when it is not faded). */
export function trimPlan(bank: Prepared, maxSeconds: number, fadeSeconds: number): { frames: number; fadeFrom: number }[] {
  const looped = loopedSamples(bank);
  return bank.samples.map((sample, s) => {
    const max = Math.round(maxSeconds * sample.rate);
    const floor = looped.has(s) ? sample.loopEnd : 0;
    const frames = Math.min(sample.frames, Math.max(max, floor));
    if (frames === sample.frames) return { frames, fadeFrom: frames };
    return { frames, fadeFrom: Math.max(floor, frames - Math.round(fadeSeconds * sample.rate)) };
  });
}

/** The PCM of one mono sample (a folded pair mixed (L + R) / 2), cut and faded per its trim plan entry. */
export function samplePcm(bank: Prepared, s: number, plan: { frames: number; fadeFrom: number }): Float32Array {
  const sample = bank.samples[s];
  const dv = new DataView(bank.smpl.buffer, bank.smpl.byteOffset, bank.smpl.byteLength);
  const out = new Float32Array(plan.frames);
  const share = 1 / sample.sources.length;
  for (const source of sample.sources) {
    for (let i = 0; i < plan.frames; i++) out[i] += (dv.getInt16((source.start + i) * 2, true) / 32768) * share;
  }
  const fade = plan.frames - plan.fadeFrom;
  for (let i = plan.fadeFrom; i < plan.frames; i++) out[i] *= (plan.frames - i) / fade;
  return out;
}

/** Pearson correlation of a folded pair's halves over its first `frames` (1 for a single mono sample). */
export function pairCorrelation(bank: Prepared, s: number, frames: number): number {
  const sample = bank.samples[s];
  if (sample.sources.length < 2) return 1;
  const dv = new DataView(bank.smpl.buffer, bank.smpl.byteOffset, bank.smpl.byteLength);
  const [l, r] = sample.sources;
  let ll = 0;
  let rr = 0;
  let lr = 0;
  for (let i = 0; i < Math.min(frames, sample.frames); i++) {
    const a = dv.getInt16((l.start + i) * 2, true);
    const b = dv.getInt16((r.start + i) * 2, true);
    ll += a * a;
    rr += b * b;
    lr += a * b;
  }
  return ll === 0 || rr === 0 ? 1 : lr / Math.sqrt(ll * rr);
}

// ---- Writing SF3 ----

class Bytes {
  private readonly parts: Uint8Array[] = [];
  length = 0;
  push(b: Uint8Array) {
    this.parts.push(b);
    this.length += b.length;
  }
  u16s(...values: number[]) {
    const b = new Uint8Array(values.length * 2);
    const d = new DataView(b.buffer);
    values.forEach((v, i) => d.setUint16(i * 2, v, true));
    this.push(b);
  }
  join(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const p of this.parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
}

function text(s: string, length: number): Uint8Array {
  const b = new Uint8Array(length);
  for (let i = 0; i < Math.min(s.length, length - 1); i++) b[i] = s.charCodeAt(i) & 0x7f;
  return b;
}

/** A chunk with an even body: alphaTab's RIFF reader does not skip pad bytes, so every size it reads must be even. */
function chunk(id: string, body: Uint8Array): Uint8Array {
  const padded = body.length % 2 ? new Uint8Array(body.length + 1) : body;
  if (padded !== body) padded.set(body);
  const out = new Uint8Array(8 + padded.length);
  out.set(text(id + '\0', 5).subarray(0, 4));
  new DataView(out.buffer).setUint32(4, padded.length, true);
  out.set(padded, 8);
  return out;
}

function list(type: string, chunks: readonly Uint8Array[]): Uint8Array {
  const body = new Bytes();
  body.push(text(type + '\0', 5).subarray(0, 4));
  for (const c of chunks) body.push(c);
  return chunk(type === 'sfbk' ? 'RIFF' : 'LIST', body.join());
}

/**
 * The SF3 file alphaTab 1.8.4 reads (`Hydra.load`, `TinySoundFont.loadPresets`):
 *  - every chunk size is even (its RIFF reader never skips a pad byte);
 *  - `smpl` holds the Ogg streams back to back; a sample header's start and end are byte offsets of its stream in `smpl`
 *    (alphaTab slices `smpl[start, end)` and decodes it whole when `sampleType & 0x10`);
 *  - loop points are frames from the sample's own start (alphaTab adds them to the decoded buffer's indices unchanged);
 *  - sampleType is mono with the Ogg flag (0x11), link 0. alphaTab only plays types with bit 0 set, so never left or right;
 *  - `ifil` is 3.1, as MuseScore's SF3 files carry, for readers other than alphaTab.
 */
export function writeSf3(bank: Prepared, oggs: readonly Uint8Array[], plan: readonly { frames: number }[]): Uint8Array {
  if (oggs.length !== bank.samples.length || plan.length !== bank.samples.length) throw new Error('one Ogg stream per sample');
  const info: Uint8Array[] = [chunk('ifil', Uint8Array.of(3, 0, 1, 0))];
  for (const { id, data } of bank.info) if (id !== 'ifil' && id !== 'ISFT') info.push(chunk(id, data));
  info.push(chunk('ISFT', text('Tab Highway prepare-bank', 26)));

  const smpl = new Bytes();
  const offsets: number[] = [];
  for (const ogg of oggs) {
    offsets.push(smpl.length);
    smpl.push(ogg);
  }

  const phdr = new Bytes();
  const pbag = new Bytes();
  const pmod = new Bytes();
  const pgen = new Bytes();
  const inst = new Bytes();
  const ibag = new Bytes();
  const imod = new Bytes();
  const igen = new Bytes();
  const shdr = new Bytes();
  const counts = { pgen: 0, pmod: 0, igen: 0, imod: 0 };
  const zoneTables = (zones: readonly Zone[], bag: Bytes, gen: Bytes, mod: Bytes, g: 'pgen' | 'igen', m: 'pmod' | 'imod') => {
    for (const zone of zones) {
      bag.u16s(counts[g], counts[m] / PMOD);
      gen.u16s(...zone.gens.flatMap((x) => [x.op, x.amount]));
      mod.push(zone.mods);
      counts[g] += zone.gens.length;
      counts[m] += zone.mods.length;
    }
  };
  const header = (b: Bytes, name: string, program: number, bank: number, bagIndex: number) => {
    b.push(text(name, 20));
    b.u16s(program, bank, bagIndex, 0, 0, 0, 0, 0, 0);
  };
  header(phdr, bank.preset.name, bank.preset.program, bank.preset.bank, 0);
  zoneTables(bank.preset.zones, pbag, pgen, pmod, 'pgen', 'pmod');
  header(phdr, 'EOP', 0, 0, bank.preset.zones.length);
  pbag.u16s(counts.pgen, counts.pmod / PMOD);
  pgen.u16s(0, 0);
  pmod.push(new Uint8Array(PMOD));

  let ibags = 0;
  for (const instrument of bank.instruments) {
    inst.push(text(instrument.name, 20));
    inst.u16s(ibags);
    ibags += instrument.zones.length;
    zoneTables(instrument.zones, ibag, igen, imod, 'igen', 'imod');
  }
  inst.push(text('EOI', 20));
  inst.u16s(ibags);
  ibag.u16s(counts.igen, counts.imod / PMOD);
  igen.u16s(0, 0);
  imod.push(new Uint8Array(PMOD));
  if (Math.max(ibags, counts.igen, counts.pgen) > 0xffff) throw new Error('too many zones or generators for SF2 tables');

  bank.samples.forEach((sample, s) => {
    const frames = plan[s].frames;
    const loopEnd = Math.min(sample.loopEnd, frames);
    const loopStart = Math.min(sample.loopStart, loopEnd);
    shdr.push(text(sample.name, 20));
    const b = new Uint8Array(26);
    const d = new DataView(b.buffer);
    d.setUint32(0, offsets[s], true);
    d.setUint32(4, offsets[s] + oggs[s].length, true);
    d.setUint32(8, loopStart, true);
    d.setUint32(12, loopEnd, true);
    d.setUint32(16, sample.rate, true);
    d.setUint8(20, sample.pitch);
    d.setInt8(21, sample.correction);
    d.setUint16(22, 0, true);
    d.setUint16(24, SAMPLE_TYPE.mono | SAMPLE_TYPE.ogg, true);
    shdr.push(b);
  });
  shdr.push(text('EOS', 20));
  shdr.push(new Uint8Array(26));

  return list('sfbk', [
    list('INFO', info),
    list('sdta', [chunk('smpl', smpl.join())]),
    list('pdta', [
      chunk('phdr', phdr.join()),
      chunk('pbag', pbag.join()),
      chunk('pmod', pmod.join()),
      chunk('pgen', pgen.join()),
      chunk('inst', inst.join()),
      chunk('ibag', ibag.join()),
      chunk('imod', imod.join()),
      chunk('igen', igen.join()),
      chunk('shdr', shdr.join()),
    ]),
  ]);
}

// ---- Reporting ----

/** How many zones sound for each key and velocity (128 x 128, key-major), walked the way alphaTab matches regions. */
export function coverage(bank: Pick<Prepared, 'preset' | 'instruments'>): Uint16Array {
  const counts = new Uint16Array(128 * 128);
  for (const pz of bank.preset.zones) {
    const inst = pz.gens.find((g) => g.op === GEN.instrument)?.amount;
    if (inst === undefined) continue;
    const [pk0, pk1] = rangeOf(pz, GEN.keyRange);
    const [pv0, pv1] = rangeOf(pz, GEN.velRange);
    for (const z of bank.instruments[inst].zones) {
      if (sampleIdOf(z) === undefined) continue;
      const [k0, k1] = rangeOf(z, GEN.keyRange);
      const [v0, v1] = rangeOf(z, GEN.velRange);
      for (let k = Math.max(k0, pk0); k <= Math.min(k1, pk1); k++) {
        for (let v = Math.max(v0, pv0); v <= Math.min(v1, pv1); v++) counts[k * 128 + v]++;
      }
    }
  }
  return counts;
}

/** One line per instrument: zones, how many set key and velocity ranges, key slots and samples per slot. */
export function layerReport(bank: Pick<Prepared, 'instruments'>): string[] {
  return bank.instruments.map((instrument) => {
    const zones = instrument.zones.filter((z) => sampleIdOf(z) !== undefined);
    const perKey = new Map<number, Set<number>>();
    for (const z of zones) {
      const key = z.gens.find((g) => g.op === GEN.keyRange)?.amount ?? 0x7f00;
      perKey.set(key, (perKey.get(key) ?? new Set()).add(sampleIdOf(z)!));
    }
    const per = [...perKey.values()].map((s) => s.size);
    const withVel = zones.filter((z) => z.gens.some((g) => g.op === GEN.velRange)).length;
    const withKey = zones.filter((z) => z.gens.some((g) => g.op === GEN.keyRange)).length;
    return `"${instrument.name}": ${zones.length} zones (keyRange on ${withKey}, velRange on ${withVel}), ${perKey.size} key slots, samples per slot ${Math.min(...per)}-${Math.max(...per)}`;
  });
}

// ---- Encoding and the command line ----

/** Encodes mono float PCM to an Ogg Vorbis stream with ffmpeg's libvorbis, stripped of encoder tags. */
function encodeOgg(ffmpeg: string, pcm: Float32Array, rate: number, quality: number): Promise<Uint8Array> {
  return new Promise((done, fail) => {
    const args = ['-hide_banner', '-loglevel', 'error', '-f', 'f32le', '-ar', String(rate), '-ac', '1', '-i', 'pipe:0'];
    args.push('-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact');
    args.push('-c:a', 'libvorbis', '-q:a', String(quality), '-f', 'ogg', 'pipe:1');
    const child = spawn(ffmpeg, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (b: Buffer) => out.push(b));
    child.stderr.on('data', (b: Buffer) => err.push(b));
    child.on('error', fail);
    child.on('close', (code) => {
      if (code === 0) done(new Uint8Array(Buffer.concat(out)));
      else fail(new Error(`ffmpeg exited ${code}: ${Buffer.concat(err).toString()}`));
    });
    child.stdin.end(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  });
}

async function mapLimited<T, R>(items: readonly T[], limit: number, f: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await f(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function parseVelocities(value: string): number[] | null {
  if (value === 'all') return null;
  if (value === 'alphatab') return [...ALPHATAB_VELOCITIES];
  const list = value.split(',').map(Number);
  if (list.some((v) => !Number.isInteger(v) || v < 0 || v > 127)) throw new Error(`bad --velocities ${value}`);
  return list;
}

const sameCoverage = (a: Uint16Array, b: Uint16Array) => a.every((v, i) => v === b[i]);

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      program: { type: 'string' },
      name: { type: 'string' },
      preset: { type: 'string', default: '0' },
      'max-seconds': { type: 'string', default: '8' },
      'fade-ms': { type: 'string', default: '50' },
      quality: { type: 'string', default: '4' },
      velocities: { type: 'string', default: 'all' },
      'extend-keys': { type: 'boolean', default: false },
      ffmpeg: { type: 'string', default: process.env.FFMPEG ?? 'ffmpeg' },
    },
  });
  const [input, output] = positionals;
  if (!input || !output || values.program === undefined) {
    console.error('usage: node scripts/prepare-bank.ts <in.sf2> <out.sf3> --program N [--name S] [--preset I] [--max-seconds 8]');
    console.error('       [--fade-ms 50] [--quality 4] [--velocities all|alphatab|v1,v2,...] [--extend-keys] [--ffmpeg path]');
    process.exitCode = 1;
    return;
  }
  const began = performance.now();
  const sf2 = parseSf2(new Uint8Array(readFileSync(resolve(input))));
  console.log(`${input}: ${sf2.presets.length} preset(s), ${sf2.instruments.length} instrument(s), ${sf2.samples.length} samples`);
  sf2.presets.forEach((p, i) => console.log(`  preset ${i}: "${p.name}" bank ${p.bank} program ${p.program}`));
  const types = new Map<number, number>();
  for (const s of sf2.samples) types.set(s.type, (types.get(s.type) ?? 0) + 1);
  console.log(`  sample types: ${[...types].map(([t, n]) => `${n} x ${t}`).join(', ')}`);
  console.log(`  before: ${layerReport(sf2).join('\n          ')}`);

  let bank = selectAndFold(sf2, { preset: Number(values.preset), program: Number(values.program), name: values.name });
  const folded = bank.samples.filter((s) => s.sources.length === 2).length;
  console.log(`folded ${folded} stereo pair(s): ${bank.samples.length} mono samples`);
  const before = coverage(bank);
  const velocities = parseVelocities(values.velocities!);
  if (velocities) {
    bank = pruneVelocities(bank, velocities);
    console.log(`velocities ${values.velocities}: ${bank.samples.length} samples kept`);
    if (!sameCoverage(before, coverage(bank))) throw new Error('pruning changed which keys and velocities sound');
  }
  if (values['extend-keys']) bank = extendKeys(bank);
  const keys = coverage(bank).reduce((n, c, i) => (c > 0 && i % 128 === 95 ? n + 1 : n), 0);
  const most = Math.max(...coverage(bank));
  console.log(`  after: ${layerReport(bank).join('\n         ')}`);
  console.log(`  ${keys} of 128 keys sound at velocity 95 (forte); at most ${most} zone(s) sound per key and velocity`);

  const plan = trimPlan(bank, Number(values['max-seconds']), Number(values['fade-ms']) / 1000);
  const trimmed = plan.filter((p, s) => p.frames < bank.samples[s].frames).length;
  const seconds = plan.reduce((sum, p, s) => sum + p.frames / bank.samples[s].rate, 0);
  console.log(`trimmed ${trimmed} of ${plan.length} samples (${loopedSamples(bank).size} looped), ${seconds.toFixed(1)} s of audio`);
  const worst = Math.min(...bank.samples.map((_, s) => pairCorrelation(bank, s, plan[s].frames)));
  if (folded) console.log(`lowest L/R correlation of a folded pair: ${worst.toFixed(4)}${worst < 0.9 ? ' (wide: mono may sound thinner)' : ''}`);

  const quality = Number(values.quality);
  const oggs = await mapLimited(bank.samples, availableParallelism(), (_, s) =>
    encodeOgg(values.ffmpeg!, samplePcm(bank, s, plan[s]), bank.samples[s].rate, quality),
  );
  const sf3 = writeSf3(bank, oggs, plan);
  writeFileSync(resolve(output), sf3);
  console.log(`wrote ${output}: ${(sf3.length / 1024 / 1024).toFixed(2)} MiB, program ${bank.preset.program} "${bank.preset.name}",`);
  console.log(`  Vorbis q${quality}, max ${values['max-seconds']} s, in ${Math.round(performance.now() - began)} ms`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
