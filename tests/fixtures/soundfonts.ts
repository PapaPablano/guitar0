/**
 * Tiny synthetic SoundFont 2 files built in code, so the bank filter can be tested without binary fixtures.
 * Each preset gets its own instrument; every sample it names becomes one zone of that instrument.
 */

/** A sample's `sampleType`: plain SF2 values, or with the SF3 Ogg flag (0x10) set. */
export type FixtureSampleType = 'mono' | 'right' | 'left' | 'linked' | 'mono-ogg' | 'left-ogg' | 'right-ogg';

const SAMPLE_TYPE: Record<FixtureSampleType, number> = {
  mono: 1,
  right: 2,
  left: 4,
  linked: 8,
  'mono-ogg': 0x11,
  'left-ogg': 0x14,
  'right-ogg': 0x12,
};

export interface FixturePreset {
  readonly name: string;
  readonly bank: number;
  readonly program: number;
  readonly samples: readonly FixtureSampleType[];
  /**
   * Makes the preset playable like a real instrument: each sample covers every key, loops while the note is held and fades
   * over this many seconds once it is released. Absent: each sample covers ten keys of its own and plays once, as before.
   */
  readonly releaseSeconds?: number;
}

const FRAMES_PER_SAMPLE = 64;
/** The spec asks for 46 zero frames after each sample. */
const SAMPLE_GAP = 46;

const GEN_PAN = 17;
const GEN_KEY_RANGE = 43;
const GEN_INSTRUMENT = 41;
const GEN_SAMPLE_ID = 53;
const GEN_RELEASE_VOL_ENV = 38;
const GEN_SAMPLE_MODES = 54;

class Writer {
  private readonly parts: number[] = [];
  u8(v: number) {
    this.parts.push(v & 0xff);
  }
  u16(v: number) {
    this.u8(v);
    this.u8(v >> 8);
  }
  u32(v: number) {
    this.u16(v & 0xffff);
    this.u16(v >>> 16);
  }
  i16(v: number) {
    this.u16(v < 0 ? v + 0x10000 : v);
  }
  text(s: string, length: number) {
    for (let i = 0; i < length; i++) this.u8(i < s.length ? s.charCodeAt(i) : 0);
  }
  bytes(b: Uint8Array | readonly number[]) {
    for (const v of b) this.u8(v);
  }
  get length() {
    return this.parts.length;
  }
  done(): Uint8Array {
    return Uint8Array.from(this.parts);
  }
}

function chunk(id: string, body: Uint8Array): Uint8Array {
  const w = new Writer();
  w.text(id, 4);
  w.u32(body.length);
  w.bytes(body);
  if (body.length % 2) w.u8(0);
  return w.done();
}

function list(type: string, chunks: readonly Uint8Array[]): Uint8Array {
  const w = new Writer();
  w.text(type, 4);
  for (const c of chunks) w.bytes(c);
  return chunk('LIST', w.done());
}

function records(write: (w: Writer) => void): Uint8Array {
  const w = new Writer();
  write(w);
  return w.done();
}

/** An SF2 file holding the given presets, in order. */
export function buildSoundFont(presets: readonly FixturePreset[]): Uint8Array {
  const samples: { type: number }[] = [];
  for (const p of presets) for (const s of p.samples) samples.push({ type: SAMPLE_TYPE[s] });

  const smpl = records((w) => {
    samples.forEach((_, k) => {
      for (let i = 0; i < FRAMES_PER_SAMPLE; i++) w.i16(((k + 1) * 997 + i * 31) % 30000);
      for (let i = 0; i < SAMPLE_GAP; i++) w.i16(0);
    });
  });

  // Preset side: a global zone (pan only), then one zone naming the preset's instrument.
  const phdr = new Writer();
  const pbag = new Writer();
  const pmod = new Writer();
  const pgen = new Writer();
  // Instrument side: a global zone (pan only), then one zone per sample.
  const inst = new Writer();
  const ibag = new Writer();
  const imod = new Writer();
  const igen = new Writer();
  const shdr = new Writer();

  let bags = 0;
  let gens = 0;
  let mods = 0;
  let ibags = 0;
  let igens = 0;
  let imods = 0;
  let sampleId = 0;
  const modulator = (w: Writer) => {
    w.u16(0x0502);
    w.u16(48);
    w.i16(960);
    w.u16(0);
    w.u16(0);
  };

  presets.forEach((p, instrument) => {
    phdr.text(p.name, 20);
    phdr.u16(p.program);
    phdr.u16(p.bank);
    phdr.u16(bags);
    phdr.u32(0);
    phdr.u32(0);
    phdr.u32(0);

    pbag.u16(gens);
    pbag.u16(mods);
    bags++;
    pgen.u16(GEN_PAN);
    pgen.i16(0);
    gens++;
    pmod.bytes(records(modulator));
    mods++;

    inst.text(`${p.name} inst`.slice(0, 19), 20);
    inst.u16(ibags);
    ibag.u16(igens);
    ibag.u16(imods);
    ibags++;
    igen.u16(GEN_PAN);
    igen.i16(0);
    igens++;
    imod.bytes(records(modulator));
    imods++;

    if (p.samples.length > 0) {
      pbag.u16(gens);
      pbag.u16(mods);
      bags++;
      pgen.u16(GEN_KEY_RANGE);
      pgen.u16(0 | (127 << 8));
      pgen.u16(GEN_INSTRUMENT);
      pgen.u16(instrument);
      gens += 2;
    }

    p.samples.forEach((type, zone) => {
      ibag.u16(igens);
      ibag.u16(imods);
      ibags++;
      igen.u16(GEN_KEY_RANGE);
      igen.u16(p.releaseSeconds !== undefined ? 127 << 8 : zone * 10 | ((zone * 10 + 9) << 8));
      igens++;
      if (p.releaseSeconds !== undefined) {
        // The sample id must stay the zone's last generator.
        igen.u16(GEN_SAMPLE_MODES);
        igen.u16(1);
        igen.u16(GEN_RELEASE_VOL_ENV);
        igen.i16(Math.round(1200 * Math.log2(p.releaseSeconds)));
        igens += 2;
      }
      igen.u16(GEN_SAMPLE_ID);
      igen.u16(sampleId);
      igens++;

      const start = sampleId * (FRAMES_PER_SAMPLE + SAMPLE_GAP);
      shdr.text(`smp${sampleId} ${type}`, 20);
      shdr.u32(start);
      shdr.u32(start + FRAMES_PER_SAMPLE);
      shdr.u32(start + 8);
      shdr.u32(start + FRAMES_PER_SAMPLE - 8);
      shdr.u32(44100);
      shdr.u8(60);
      shdr.u8(0);
      shdr.u16(0);
      shdr.u16(SAMPLE_TYPE[type]);
      sampleId++;
    });
  });

  // Terminal records.
  phdr.text('EOP', 20);
  phdr.u16(0);
  phdr.u16(0);
  phdr.u16(bags);
  phdr.u32(0);
  phdr.u32(0);
  phdr.u32(0);
  pbag.u16(gens);
  pbag.u16(mods);
  pgen.u32(0);
  pmod.bytes(new Uint8Array(10));
  inst.text('EOI', 20);
  inst.u16(ibags);
  ibag.u16(igens);
  ibag.u16(imods);
  igen.u32(0);
  imod.bytes(new Uint8Array(10));
  shdr.text('EOS', 20);
  shdr.bytes(new Uint8Array(26));

  const info = list('INFO', [
    chunk('ifil', records((w) => (w.u16(2), w.u16(1)))),
    chunk('isng', records((w) => w.text('EMU8000', 8))),
    chunk('INAM', records((w) => w.text('Fixture bank', 13))), // odd length: exercises the pad byte
  ]);
  const sdta = list('sdta', [chunk('smpl', smpl)]);
  const pdta = list('pdta', [
    chunk('phdr', phdr.done()),
    chunk('pbag', pbag.done()),
    chunk('pmod', pmod.done()),
    chunk('pgen', pgen.done()),
    chunk('inst', inst.done()),
    chunk('ibag', ibag.done()),
    chunk('imod', imod.done()),
    chunk('igen', igen.done()),
    chunk('shdr', shdr.done()),
  ]);

  const body = new Writer();
  body.text('sfbk', 4);
  body.bytes(info);
  body.bytes(sdta);
  body.bytes(pdta);
  return chunk('RIFF', body.done());
}

// ---- Independent reader used by the assertions ----

function tag(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** The same whole-file check as `isWholeSoundFont` in `src/audio/soundfont-cache.ts`. */
export function riffSizeMatches(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  if (tag(bytes, 0) !== 'RIFF' || tag(bytes, 8) !== 'sfbk') return false;
  return view(bytes).getUint32(4, true) + 8 === bytes.length;
}

/** Every sub-chunk inside the given LIST type, by id. */
function subChunks(bytes: Uint8Array, listType: string): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const dv = view(bytes);
  let at = 12;
  while (at + 8 <= bytes.length) {
    const size = dv.getUint32(at + 4, true);
    if (tag(bytes, at) === 'LIST' && tag(bytes, at + 8) === listType) {
      let sub = at + 12;
      const end = at + 8 + size;
      while (sub + 8 <= end) {
        const subSize = dv.getUint32(sub + 4, true);
        out.set(tag(bytes, sub), bytes.subarray(sub + 8, sub + 8 + subSize));
        sub += 8 + subSize + (subSize % 2);
      }
    }
    at += 8 + size + (size % 2);
  }
  return out;
}

/** The raw `smpl` payload. */
export function sampleData(bytes: Uint8Array): Uint8Array {
  return subChunks(bytes, 'sdta').get('smpl') ?? new Uint8Array(0);
}

/** The instrument-side and sample-header chunks, which the filter must leave as they are. */
export function instrumentChunks(bytes: Uint8Array): Uint8Array[] {
  const pdta = subChunks(bytes, 'pdta');
  return ['inst', 'ibag', 'imod', 'igen', 'shdr'].map((id) => pdta.get(id) ?? new Uint8Array(0));
}

export interface ReadPreset {
  readonly name: string;
  readonly bank: number;
  readonly program: number;
  /** Every sample ID reachable through the preset's zones and their instruments. */
  readonly sampleIds: readonly number[];
}

/** Every preset (without the terminal record), walked the way a synth does: preset zone → instrument → sample ID. */
export function readPresets(bytes: Uint8Array): ReadPreset[] {
  const pdta = subChunks(bytes, 'pdta');
  const get = (id: string) => {
    const b = pdta.get(id);
    if (!b) throw new Error(`missing ${id}`);
    return { b, dv: view(b) };
  };
  const phdr = get('phdr');
  const pbag = get('pbag');
  const pgen = get('pgen');
  const inst = get('inst');
  const ibag = get('ibag');
  const igen = get('igen');
  const name = (b: Uint8Array, at: number) => {
    let s = '';
    for (let i = 0; i < 20 && b[at + i] !== 0; i++) s += String.fromCharCode(b[at + i]);
    return s;
  };
  const presets: ReadPreset[] = [];
  const count = phdr.b.length / 38 - 1;
  for (let p = 0; p < count; p++) {
    const at = p * 38;
    const bagFrom = phdr.dv.getUint16(at + 24, true);
    const bagTo = phdr.dv.getUint16(at + 38 + 24, true);
    const sampleIds: number[] = [];
    for (let bag = bagFrom; bag < bagTo; bag++) {
      const genFrom = pbag.dv.getUint16(bag * 4, true);
      const genTo = pbag.dv.getUint16(bag * 4 + 4, true);
      for (let g = genFrom; g < genTo; g++) {
        if (pgen.dv.getUint16(g * 4, true) !== GEN_INSTRUMENT) continue;
        const i = pgen.dv.getUint16(g * 4 + 2, true);
        const ibagFrom = inst.dv.getUint16(i * 22 + 20, true);
        const ibagTo = inst.dv.getUint16(i * 22 + 22 + 20, true);
        for (let ib = ibagFrom; ib < ibagTo; ib++) {
          const igFrom = ibag.dv.getUint16(ib * 4, true);
          const igTo = ibag.dv.getUint16(ib * 4 + 4, true);
          for (let ig = igFrom; ig < igTo; ig++) {
            if (igen.dv.getUint16(ig * 4, true) === GEN_SAMPLE_ID) sampleIds.push(igen.dv.getUint16(ig * 4 + 2, true));
          }
        }
      }
    }
    presets.push({
      name: name(phdr.b, at),
      bank: phdr.dv.getUint16(at + 22, true),
      program: phdr.dv.getUint16(at + 20, true),
      sampleIds,
    });
  }
  return presets;
}
