import { GUITAR_TONES, type GuitarTone } from './guitar-tone';

/**
 * Reads an SF2/SF3 bank and writes a filtered copy for layering over MuseScore General (KTD2):
 *  - kept: bank 0 presets for programs 24 to 34 (guitars and basses) whose zones all use mono samples;
 *  - muted candidates: mono presets named as a palm mute for a tone (KTD5), moved to the layer's reserved bank;
 *  - disabled: everything else, moved to `DISABLED_BANK` with no zones, so it can neither shadow a lower bank
 *    nor make alphaTab decode its samples (alphaTab picks samples to decode by program number, whatever the bank).
 * Only the preset side of `pdta` (phdr, pbag, pmod, pgen) is rewritten; sample data and instruments are copied as they are.
 */

/** Where disabled presets go. alphaTab reads melodic banks as `bank & 2047`, so nothing selects this one. */
export const DISABLED_BANK = 2047;

/** General MIDI programs this filter keeps: nylon guitar (24) to picked bass (34). */
export const FIRST_COVERED_PROGRAM = 24;
export const LAST_COVERED_PROGRAM = 34;

export type RejectReason = 'stereo' | 'missing';

/** Why a preset was disabled. `unused` is any preset that is neither a bank 0 guitar or bass nor a palm-mute candidate. */
export type DisabledReason = RejectReason | 'duplicate' | 'unused';

export interface BankReport {
  /** Programs 24 to 34 that this bank now plays, with the preset that plays each. */
  readonly covered: readonly { readonly program: number; readonly name: string }[];
  /** Programs 24 to 34 it does not play: `stereo` when its bank 0 preset uses non-mono samples, otherwise `missing`. */
  readonly rejected: readonly { readonly program: number; readonly reason: RejectReason; readonly name?: string }[];
  /** At most one palm-mute preset per tone, at the reserved bank and that tone's own program. */
  readonly mutedCandidates: readonly {
    readonly tone: GuitarTone;
    readonly bank: number;
    readonly program: number;
    readonly name: string;
  }[];
  /** Presets switched off in the copy, at their original bank and program. */
  readonly disabled: readonly {
    readonly name: string;
    readonly bank: number;
    readonly program: number;
    readonly reason: DisabledReason;
  }[];
}

export type FilterResult =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly report: BankReport }
  | { readonly ok: false; readonly reason: string };

export interface FilterOptions {
  /** The bank this layer's muted candidates move to; unique per layer, not 0, 128 or `DISABLED_BANK`. */
  readonly reservedBank: number;
}

const PHDR = 38;
const PBAG = 4;
const PMOD = 10;
const PGEN = 4;
const INST = 22;
const IBAG = 4;
const IGEN = 4;
const SHDR = 46;

const GEN_INSTRUMENT = 41;
const GEN_SAMPLE_ID = 53;
const PERCUSSION_BANK = 128;
/** SF3 marks Ogg-compressed samples with this bit on top of the SF2 sample type. */
const OGG_FLAG = 0x10;
const MONO = 1;

class Damaged extends Error {}

function damaged(message: string): never {
  throw new Damaged(message);
}

interface Chunk {
  readonly id: string;
  /** Offset of the chunk's 8-byte header. */
  readonly at: number;
  readonly size: number;
}

function tag(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
}

/** The chunks laid out from `from` up to `end`. A chunk running past `end` means the file was cut short. */
function chunksIn(bytes: Uint8Array, dv: DataView, from: number, end: number): Chunk[] {
  const chunks: Chunk[] = [];
  let at = from;
  while (at + 8 <= end) {
    const size = dv.getUint32(at + 4, true);
    if (at + 8 + size > end) damaged('The file is cut short.');
    chunks.push({ id: tag(bytes, at), at, size });
    at += 8 + size + (size % 2);
  }
  if (at < end && at + 1 !== end) damaged('The file is cut short.');
  return chunks;
}

/** A fixed-size record table: `count` includes the terminal record the format ends every table with. */
interface Table {
  readonly body: Uint8Array;
  readonly dv: DataView;
  readonly count: number;
}

function table(bytes: Uint8Array, chunk: Chunk | undefined, record: number, id: string): Table {
  if (!chunk) damaged(`The bank has no ${id} list.`);
  if (chunk.size % record !== 0 || chunk.size < record) damaged(`The bank's ${id} list is damaged.`);
  const body = bytes.subarray(chunk.at + 8, chunk.at + 8 + chunk.size);
  return { body, dv: new DataView(body.buffer, body.byteOffset, body.byteLength), count: chunk.size / record };
}

function presetName(body: Uint8Array, at: number): string {
  let name = '';
  for (let i = 0; i < 20 && body[at + i] !== 0; i++) name += String.fromCharCode(body[at + i]);
  return name.trimEnd();
}

/** Mono, ignoring SF3's Ogg flag. Right, left, linked and ROM samples are all "not mono". */
function isMono(sampleType: number): boolean {
  return (sampleType & ~OGG_FLAG) === MONO;
}

/** The tone a palm-mute preset is for, from its name (KTD5), or null when it is not one. */
export function mutedToneOfName(name: string): GuitarTone | null {
  const n = name.toLowerCase();
  if (!n.includes('mute') && !n.includes('palm')) return null;
  if (n.includes('dist')) return 'distortion';
  if (n.includes('crunch') || n.includes('overdrive')) return 'crunch';
  if (n.includes('clean')) return 'clean';
  return null;
}

interface Pdta {
  readonly phdr: Table;
  readonly pbag: Table;
  readonly pmod: Table;
  readonly pgen: Table;
  readonly inst: Table;
  readonly ibag: Table;
  readonly igen: Table;
  readonly shdr: Table;
}

interface Preset {
  readonly index: number;
  readonly name: string;
  readonly bank: number;
  readonly program: number;
  readonly bagFrom: number;
  readonly bagTo: number;
  readonly samples: 'mono' | RejectReason;
}

/** What a preset's zones play: all mono, some non-mono sample, or nothing playable. */
function sampleKind(pdta: Pdta, bagFrom: number, bagTo: number): Preset['samples'] {
  const { pbag, pgen, inst, ibag, igen, shdr } = pdta;
  let zones = 0;
  let stereo = false;
  for (let bag = bagFrom; bag < bagTo; bag++) {
    const genTo = pbag.dv.getUint16((bag + 1) * PBAG, true);
    for (let g = pbag.dv.getUint16(bag * PBAG, true); g < genTo; g++) {
      if (pgen.dv.getUint16(g * PGEN, true) !== GEN_INSTRUMENT) continue;
      const i = pgen.dv.getUint16(g * PGEN + 2, true);
      if (i >= inst.count - 1) return 'missing';
      const ibagFrom = inst.dv.getUint16(i * INST + 20, true);
      const ibagTo = inst.dv.getUint16((i + 1) * INST + 20, true);
      if (ibagFrom > ibagTo || ibagTo >= ibag.count) return 'missing';
      for (let ib = ibagFrom; ib < ibagTo; ib++) {
        const igFrom = ibag.dv.getUint16(ib * IBAG, true);
        const igTo = ibag.dv.getUint16((ib + 1) * IBAG, true);
        if (igFrom > igTo || igTo > igen.count) return 'missing';
        for (let ig = igFrom; ig < igTo; ig++) {
          if (igen.dv.getUint16(ig * IGEN, true) !== GEN_SAMPLE_ID) continue;
          const s = igen.dv.getUint16(ig * IGEN + 2, true);
          if (s >= shdr.count - 1) return 'missing';
          zones++;
          if (!isMono(shdr.dv.getUint16(s * SHDR + 44, true))) stereo = true;
        }
      }
    }
  }
  if (zones === 0) return 'missing';
  return stereo ? 'stereo' : 'mono';
}

function readPresets(pdta: Pdta): Preset[] {
  const { phdr, pbag, pgen, pmod } = pdta;
  // Every bag range, and every generator and modulator range a bag points at, must lie inside its table.
  for (let b = 0; b + 1 < pbag.count; b++) {
    const genFrom = pbag.dv.getUint16(b * PBAG, true);
    const genTo = pbag.dv.getUint16((b + 1) * PBAG, true);
    const modFrom = pbag.dv.getUint16(b * PBAG + 2, true);
    const modTo = pbag.dv.getUint16((b + 1) * PBAG + 2, true);
    if (genFrom > genTo || genTo > pgen.count || modFrom > modTo || modTo > pmod.count) {
      damaged("The bank's preset zones are damaged.");
    }
  }
  const presets: Preset[] = [];
  for (let p = 0; p + 1 < phdr.count; p++) {
    const at = p * PHDR;
    const bagFrom = phdr.dv.getUint16(at + 24, true);
    const bagTo = phdr.dv.getUint16(at + PHDR + 24, true);
    if (bagFrom > bagTo || bagTo >= pbag.count) damaged("The bank's preset list is damaged.");
    presets.push({
      index: p,
      name: presetName(phdr.body, at),
      program: phdr.dv.getUint16(at + 20, true),
      bank: phdr.dv.getUint16(at + 22, true),
      bagFrom,
      bagTo,
      samples: sampleKind(pdta, bagFrom, bagTo),
    });
  }
  return presets;
}

function isCoveredSlot(p: Preset): boolean {
  return p.bank === 0 && p.program >= FIRST_COVERED_PROGRAM && p.program <= LAST_COVERED_PROGRAM;
}

interface Placement {
  readonly preset: Preset;
  readonly bank: number;
  readonly program: number;
  /** False for a disabled preset, which keeps no zones. */
  readonly zones: boolean;
}

function classify(presets: readonly Preset[], reservedBank: number) {
  const placements: Placement[] = [];
  const covered = new Map<number, string>();
  const muted = new Map<GuitarTone, string>();
  const mutedCandidates: { tone: GuitarTone; bank: number; program: number; name: string }[] = [];
  const disabled: { name: string; bank: number; program: number; reason: DisabledReason }[] = [];

  for (const p of presets) {
    const slot = isCoveredSlot(p);
    const tone = mutedToneOfName(p.name);
    const mono = p.samples === 'mono';
    let placed = false;
    if (slot && mono && !covered.has(p.program)) {
      covered.set(p.program, p.name);
      placements.push({ preset: p, bank: 0, program: p.program, zones: true });
      placed = true;
    }
    if (tone && mono && !muted.has(tone)) {
      const program = GUITAR_TONES.find((t) => t.id === tone)!.program;
      muted.set(tone, p.name);
      mutedCandidates.push({ tone, bank: reservedBank, program, name: p.name });
      placements.push({ preset: p, bank: reservedBank, program, zones: true });
      placed = true;
    }
    if (placed) continue;
    const reason: DisabledReason = slot || tone ? (mono ? 'duplicate' : p.samples) : 'unused';
    disabled.push({ name: p.name, bank: p.bank, program: p.program, reason });
    placements.push({ preset: p, bank: DISABLED_BANK, program: p.program, zones: false });
  }

  const rejected: { program: number; reason: RejectReason; name?: string }[] = [];
  for (let program = FIRST_COVERED_PROGRAM; program <= LAST_COVERED_PROGRAM; program++) {
    if (covered.has(program)) continue;
    const atSlot = presets.find((p) => isCoveredSlot(p) && p.program === program);
    if (atSlot && atSlot.samples !== 'mono') rejected.push({ program, reason: atSlot.samples, name: atSlot.name });
    else rejected.push({ program, reason: 'missing' });
  }

  const report: BankReport = {
    covered: [...covered].sort(([a], [b]) => a - b).map(([program, name]) => ({ program, name })),
    rejected,
    mutedCandidates,
    disabled,
  };
  return { placements, report };
}

class Out {
  private readonly chunks: Uint8Array[] = [];
  private size = 0;
  push(bytes: Uint8Array) {
    this.chunks.push(bytes);
    this.size += bytes.length;
  }
  get length() {
    return this.size;
  }
  join(): Uint8Array {
    const out = new Uint8Array(this.size);
    let at = 0;
    for (const c of this.chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }
}

function header(id: string, size: number, type?: string): Uint8Array {
  const h = new Uint8Array(type ? 12 : 8);
  for (let i = 0; i < 4; i++) h[i] = id.charCodeAt(i);
  new DataView(h.buffer).setUint32(4, size, true);
  if (type) for (let i = 0; i < 4; i++) h[8 + i] = type.charCodeAt(i);
  return h;
}

/** A chunk copied as it is, with its pad byte (added when the source left the last one off). */
function rawChunk(bytes: Uint8Array, c: Chunk): Uint8Array {
  const length = 8 + c.size + (c.size % 2);
  if (c.at + length <= bytes.length) return bytes.subarray(c.at, c.at + length);
  const copy = new Uint8Array(length);
  copy.set(bytes.subarray(c.at, c.at + 8 + c.size));
  return copy;
}

function u16(value: number, what: string): number {
  if (value > 0xffff) damaged(`The filtered bank has too many preset ${what}.`);
  return value;
}

/** The rewritten preset-side tables, keyed by chunk id. */
function presetTables(pdta: Pdta, placements: readonly Placement[]): Map<string, Uint8Array> {
  const { phdr, pbag, pmod, pgen } = pdta;
  const phdrOut = new Uint8Array((placements.length + 1) * PHDR);
  const phdrDv = new DataView(phdrOut.buffer);
  const pbags: number[] = [];
  const pgens = new Out();
  const pmods = new Out();
  let gens = 0;
  let mods = 0;

  placements.forEach((placement, i) => {
    const { preset } = placement;
    phdrOut.set(phdr.body.subarray(preset.index * PHDR, (preset.index + 1) * PHDR), i * PHDR);
    phdrDv.setUint16(i * PHDR + 20, placement.program, true);
    phdrDv.setUint16(i * PHDR + 22, placement.bank, true);
    phdrDv.setUint16(i * PHDR + 24, u16(pbags.length / 2, 'zones'), true);
    if (!placement.zones) return;
    for (let bag = preset.bagFrom; bag < preset.bagTo; bag++) {
      pbags.push(u16(gens, 'generators'), u16(mods, 'modulators'));
      const genFrom = pbag.dv.getUint16(bag * PBAG, true);
      const genTo = pbag.dv.getUint16((bag + 1) * PBAG, true);
      const modFrom = pbag.dv.getUint16(bag * PBAG + 2, true);
      const modTo = pbag.dv.getUint16((bag + 1) * PBAG + 2, true);
      pgens.push(pgen.body.subarray(genFrom * PGEN, genTo * PGEN));
      pmods.push(pmod.body.subarray(modFrom * PMOD, modTo * PMOD));
      gens += genTo - genFrom;
      mods += modTo - modFrom;
    }
  });

  // Terminal records: the original EOP header pointing past the last bag, a closing bag, and the closing generator and modulator.
  const last = placements.length * PHDR;
  phdrOut.set(phdr.body.subarray((phdr.count - 1) * PHDR), last);
  phdrDv.setUint16(last + 24, u16(pbags.length / 2, 'zones'), true);
  pbags.push(u16(gens, 'generators'), u16(mods, 'modulators'));
  pgens.push(new Uint8Array(PGEN));
  pmods.push(new Uint8Array(PMOD));

  const pbagOut = new Uint8Array(pbags.length * 2);
  const pbagDv = new DataView(pbagOut.buffer);
  pbags.forEach((v, i) => pbagDv.setUint16(i * 2, v, true));

  return new Map([
    ['phdr', phdrOut],
    ['pbag', pbagOut],
    ['pmod', pmods.join()],
    ['pgen', pgens.join()],
  ]);
}

function filter(bytes: Uint8Array, options: FilterOptions): FilterResult {
  const { reservedBank } = options;
  if (!Number.isInteger(reservedBank) || reservedBank < 1 || reservedBank >= DISABLED_BANK || reservedBank === PERCUSSION_BANK) {
    return { ok: false, reason: `Bank ${reservedBank} cannot hold palm-mute sounds.` };
  }
  if (bytes.length < 12 || tag(bytes, 0) !== 'RIFF' || tag(bytes, 8) !== 'sfbk') {
    return { ok: false, reason: 'This is not an SF2 or SF3 sound bank.' };
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = dv.getUint32(4, true) + 8;
  if (end > bytes.length) return { ok: false, reason: 'The file is cut short.' };

  const top = chunksIn(bytes, dv, 12, end);
  const pdtaList = top.find((c) => c.id === 'LIST' && c.size >= 4 && tag(bytes, c.at + 8) === 'pdta');
  if (!pdtaList) return { ok: false, reason: 'The bank has no preset data.' };
  const subs = chunksIn(bytes, dv, pdtaList.at + 12, pdtaList.at + 8 + pdtaList.size);
  const sub = (id: string) => subs.find((c) => c.id === id);
  const pdta: Pdta = {
    phdr: table(bytes, sub('phdr'), PHDR, 'preset'),
    pbag: table(bytes, sub('pbag'), PBAG, 'preset zone'),
    pmod: table(bytes, sub('pmod'), PMOD, 'preset modulator'),
    pgen: table(bytes, sub('pgen'), PGEN, 'preset generator'),
    inst: table(bytes, sub('inst'), INST, 'instrument'),
    ibag: table(bytes, sub('ibag'), IBAG, 'instrument zone'),
    igen: table(bytes, sub('igen'), IGEN, 'instrument generator'),
    shdr: table(bytes, sub('shdr'), SHDR, 'sample'),
  };
  if (!sub('imod')) damaged('The bank has no instrument modulator list.');

  const { placements, report } = classify(readPresets(pdta), reservedBank);
  const rewritten = presetTables(pdta, placements);

  // The new pdta: every sub-chunk in its original order, the preset side replaced, the rest copied byte for byte.
  const pdtaBody = new Out();
  for (const c of subs) {
    const replacement = rewritten.get(c.id);
    if (replacement) {
      pdtaBody.push(header(c.id, replacement.length));
      pdtaBody.push(replacement);
    } else {
      pdtaBody.push(rawChunk(bytes, c));
    }
  }

  const body = new Out();
  for (const c of top) {
    if (c === pdtaList) {
      body.push(header('LIST', pdtaBody.length + 4, 'pdta'));
      body.push(pdtaBody.join());
    } else {
      body.push(rawChunk(bytes, c));
    }
  }
  const out = new Out();
  out.push(header('RIFF', body.length + 4, 'sfbk'));
  out.push(body.join());
  return { ok: true, bytes: out.join(), report };
}

/**
 * Inspects an SF2/SF3 bank and returns a filtered copy plus a report of what it covers, or a failure with a
 * player-facing reason when the bytes are not a whole, readable bank. Never throws.
 */
export function filterBank(bytes: Uint8Array, options: FilterOptions): FilterResult {
  try {
    return filter(bytes, options);
  } catch (e) {
    // Any other error means a structure this reader did not expect: the bank is reported unreadable, not crashed on.
    return { ok: false, reason: e instanceof Damaged ? e.message : 'The bank could not be read.' };
  }
}
