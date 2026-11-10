import { describe, expect, it } from 'vitest';
import {
  ALPHATAB_VELOCITIES,
  coverage,
  extendKeys,
  GEN,
  parseSf2,
  pruneVelocities,
  samplePcm,
  selectAndFold,
  trimPlan,
  writeSf3,
  type Prepared,
  type Sf2Bank,
  type Zone,
} from '../../scripts/prepare-bank';
import { filterBank } from '../../src/audio/soundfont-inspect';
import { buildSoundFont, readPresets, riffSizeMatches } from '../fixtures/soundfonts';

/** The fixture bank with each left sample linked to the right one after it, as a real stereo pair is. */
function linkPairs(bank: Sf2Bank): Sf2Bank {
  return {
    ...bank,
    samples: bank.samples.map((s, i) => {
      if ((s.type & 4) && ((bank.samples[i + 1]?.type ?? 0) & 2)) return { ...s, link: i + 1 };
      if ((s.type & 2) && ((bank.samples[i - 1]?.type ?? 0) & 4)) return { ...s, link: i - 1 };
      return s;
    }),
  };
}

const stereoBank = () =>
  linkPairs(parseSf2(buildSoundFont([{ name: 'Dist Gtr', bank: 0, program: 0, samples: ['left', 'right'], releaseSeconds: 0.5 }])));

const ops = (zone: Zone) => zone.gens.map((g) => g.op);

describe('selectAndFold', () => {
  it('folds a linked left and right pair into one centred mono sample that each note plays once', () => {
    const stereo = stereoBank();
    const folded = selectAndFold(stereo, { preset: 0, program: 30 });
    expect(folded.samples).toHaveLength(1);
    expect(folded.samples[0].sources.map((s) => s.type)).toEqual([4, 2]);
    const zones = folded.instruments[0].zones.filter((z) => ops(z).includes(GEN.sampleId));
    expect(zones).toHaveLength(1);
    expect(ops(zones[0])).not.toContain(GEN.pan);
    expect(Math.max(...coverage(folded))).toBe(1);
  });

  it('mixes the pair as (L + R) / 2', () => {
    const folded = selectAndFold(stereoBank(), { preset: 0, program: 30 });
    const pcm = samplePcm(folded, 0, { frames: 4, fadeFrom: 4 });
    const dv = new DataView(folded.smpl.buffer, folded.smpl.byteOffset, folded.smpl.byteLength);
    const [l, r] = folded.samples[0].sources;
    for (let i = 0; i < 4; i++) {
      const expected = (dv.getInt16((l.start + i) * 2, true) + dv.getInt16((r.start + i) * 2, true)) / 2 / 32768;
      expect(pcm[i]).toBeCloseTo(expected, 6);
    }
  });

  it('keeps a mono bank as it is, moved to bank 0 at the new program and name', () => {
    const bank = parseSf2(buildSoundFont([{ name: 'Bass', bank: 0, program: 0, samples: ['mono', 'mono', 'mono'] }]));
    const folded = selectAndFold(bank, { preset: 0, program: 33, name: 'Finger Bass' });
    expect(folded.preset).toMatchObject({ name: 'Finger Bass', program: 33, bank: 0 });
    expect(folded.samples.map((s) => s.sources.length)).toEqual([1, 1, 1]);
    expect(folded.samples[0].loopStart).toBe(8); // relative to the sample's own start
  });

  it('refuses a bank that is already SF3', () => {
    const bank = parseSf2(buildSoundFont([{ name: 'Ogg', bank: 0, program: 27, samples: ['mono-ogg'] }]));
    expect(() => selectAndFold(bank, { preset: 0, program: 27 })).toThrow(/already compressed/);
  });
});

describe('pruneVelocities', () => {
  /** One key slot with a zone per velocity, alternating two takes in a soft (0-92) and a loud (93-127) layer, like FreePats. */
  function takesBank(): Prepared {
    const sample = (name: string) => ({ name, rate: 44100, pitch: 60, correction: 0, sources: [], frames: 10, loopStart: 0, loopEnd: 0 });
    const zones: Zone[] = Array.from({ length: 128 }, (_, v) => ({
      gens: [
        { op: GEN.keyRange, amount: 0 | (127 << 8) },
        { op: GEN.velRange, amount: v | (v << 8) },
        { op: GEN.sampleId, amount: (v <= 92 ? 0 : 2) + (v % 2) },
      ],
      mods: new Uint8Array(0),
    }));
    return {
      info: [],
      smpl: new Uint8Array(0),
      preset: { name: 'P', program: 30, bank: 0, zones: [{ gens: [{ op: GEN.instrument, amount: 0 }], mods: new Uint8Array(0) }] },
      instruments: [{ name: 'I', zones }],
      samples: ['soft-even', 'soft-odd', 'loud-even', 'loud-odd'].map(sample),
    };
  }

  it("keeps only the takes alphaTab's velocities reach, and every velocity still sounds once", () => {
    const bank = takesBank();
    const pruned = pruneVelocities(bank, ALPHATAB_VELOCITIES);
    expect(pruned.samples.map((s) => s.name)).toEqual(['soft-odd', 'loud-odd']);
    expect(coverage(pruned)).toEqual(coverage(bank));
    // Merged into one zone per take: the nearest-take rule moves only velocity 92 (never written by alphaTab) to the loud layer.
    const ranges = pruned.instruments[0].zones.map((z) => z.gens.find((g) => g.op === GEN.velRange)!.amount);
    expect(ranges.map((a) => [a & 0xff, a >> 8])).toEqual([
      [0, 91],
      [92, 127],
    ]);
  });
});

describe('extendKeys', () => {
  it('lets a note outside the sampled keys play the nearest sample instead of nothing', () => {
    // The fixture gives three zones ten keys each: 0-9, 10-19 and 20-29. Here the lowest starts at 3 and the preset plays 0-25.
    const bank = selectAndFold(parseSf2(buildSoundFont([{ name: 'Bass', bank: 0, program: 0, samples: ['mono', 'mono', 'mono'] }])), {
      preset: 0,
      program: 33,
    });
    const keys = (z: Zone, lo: number, hi: number): Zone => ({
      ...z,
      gens: z.gens.map((g) => (g.op === GEN.keyRange ? { op: g.op, amount: lo | (hi << 8) } : g)),
    });
    const narrowed: Prepared = {
      ...bank,
      instruments: [{ ...bank.instruments[0], zones: bank.instruments[0].zones.map((z, i) => (i === 1 ? keys(z, 3, 9) : z)) }],
      preset: {
        ...bank.preset,
        zones: bank.preset.zones.map((z) => keys(z, 0, 25)),
      },
    };
    const sounding = (b: Prepared, key: number) => coverage(b)[key * 128 + 95];
    expect([2, 26, 60].map((k) => sounding(narrowed, k))).toEqual([0, 0, 0]);
    const extended = extendKeys(narrowed);
    for (let key = 0; key < 128; key++) expect(sounding(extended, key), `key ${key}`).toBe(1);
    // The middle zone keeps its keys.
    const middle = extended.instruments[0].zones.find((z) => z.gens.some((g) => g.op === GEN.sampleId && g.amount === 1))!;
    expect(middle.gens.find((g) => g.op === GEN.keyRange)!.amount).toBe(10 | (19 << 8));
  });
});

describe('trimPlan', () => {
  const bank = (looped: boolean): Prepared => ({
    info: [],
    smpl: new Uint8Array(0),
    preset: { name: 'P', program: 27, bank: 0, zones: [{ gens: [{ op: GEN.instrument, amount: 0 }], mods: new Uint8Array(0) }] },
    instruments: [
      {
        name: 'I',
        zones: [{ gens: [...(looped ? [{ op: GEN.sampleModes, amount: 1 }] : []), { op: GEN.sampleId, amount: 0 }], mods: new Uint8Array(0) }],
      },
    ],
    samples: [{ name: 's', rate: 1000, pitch: 60, correction: 0, sources: [], frames: 5000, loopStart: 3000, loopEnd: 4000 }],
  });

  it('cuts an unlooped sample to the maximum length and fades its end', () => {
    expect(trimPlan(bank(false), 2, 0.05)).toEqual([{ frames: 2000, fadeFrom: 1950 }]);
  });

  it('keeps a looped sample up to its loop end and never fades inside the loop', () => {
    expect(trimPlan(bank(true), 2, 0.05)).toEqual([{ frames: 4000, fadeFrom: 4000 }]);
    expect(trimPlan(bank(true), 4.5, 0.6)).toEqual([{ frames: 4500, fadeFrom: 4000 }]);
  });

  it('leaves a sample shorter than the maximum whole', () => {
    expect(trimPlan(bank(false), 10, 0.05)).toEqual([{ frames: 5000, fadeFrom: 5000 }]);
  });
});

describe('writeSf3', () => {
  const tag = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

  /** Every chunk in the file, with its size, walking LISTs the way alphaTab's RIFF reader does (no pad bytes skipped). */
  function chunks(bytes: Uint8Array): Map<string, { at: number; size: number }> {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const found = new Map<string, { at: number; size: number }>();
    const walk = (from: number, end: number) => {
      for (let at = from; at + 8 <= end; ) {
        const size = dv.getUint32(at + 4, true);
        const id = tag(bytes, at);
        found.set(id === 'LIST' ? tag(bytes, at + 8) : id, { at: at + 8, size });
        if (id === 'LIST') walk(at + 12, at + 8 + size);
        at += 8 + size;
      }
    };
    walk(12, bytes.length);
    return found;
  }

  function prepared() {
    const bank = parseSf2(buildSoundFont([{ name: 'Clean', bank: 0, program: 0, samples: ['mono', 'mono'] }]));
    const folded = selectAndFold(bank, { preset: 0, program: 27, name: 'Clean Gtr' });
    // Stand-ins for Ogg streams; one of odd length, so the smpl chunk needs padding.
    const oggs = [Uint8Array.of(1, 2, 3), Uint8Array.of(4, 5, 6, 7, 8)];
    return { folded, sf3: writeSf3(folded, oggs, trimPlan(folded, 60, 0.05)), oggs };
  }

  it('lays the Ogg streams back to back, with byte offsets, relative loops and the mono Ogg type', () => {
    const { sf3, oggs } = prepared();
    const found = chunks(sf3);
    const shdr = found.get('shdr')!;
    const dv = new DataView(sf3.buffer, sf3.byteOffset + shdr.at, shdr.size);
    expect(shdr.size).toBe(3 * 46);
    const record = (s: number) => [0, 4, 8, 12].map((o) => dv.getUint32(s * 46 + 20 + o, true));
    expect(record(0)).toEqual([0, 3, 8, 56]);
    expect(record(1)).toEqual([3, 8, 8, 56]);
    expect(dv.getUint16(44, true)).toBe(0x11);
    expect(dv.getUint16(46 + 44, true)).toBe(0x11);
    const smpl = found.get('smpl')!;
    expect(Array.from(sf3.subarray(smpl.at, smpl.at + 8))).toEqual([...oggs[0], ...oggs[1]]);
    const ifil = found.get('ifil')!;
    expect(Array.from(sf3.subarray(ifil.at, ifil.at + 4))).toEqual([3, 0, 1, 0]);
  });

  it('gives every chunk an even size and a RIFF size that matches the file', () => {
    const { sf3 } = prepared();
    expect(riffSizeMatches(sf3)).toBe(true);
    for (const [id, c] of chunks(sf3)) expect(c.size % 2, id).toBe(0);
  });

  it('writes one preset at bank 0 and the new program, which the bank filter keeps', () => {
    const { sf3 } = prepared();
    expect(readPresets(sf3)).toEqual([{ name: 'Clean Gtr', bank: 0, program: 27, sampleIds: [0, 1] }]);
    const result = filterBank(sf3, { reservedBank: 301 });
    expect(result.ok && result.report.covered).toEqual([{ program: 27, name: 'Clean Gtr' }]);
    expect(result.ok && result.report.rejected.filter((r) => r.reason === 'stereo')).toEqual([]);
  });

  it('writes a folded stereo bank that the filter no longer rejects as stereo', () => {
    const before = filterBank(buildSoundFont([{ name: 'Dist Gtr', bank: 0, program: 30, samples: ['left', 'right'] }]), { reservedBank: 301 });
    expect(before.ok && before.report.rejected.find((r) => r.program === 30)?.reason).toBe('stereo');
    const folded = selectAndFold(stereoBank(), { preset: 0, program: 30 });
    const after = filterBank(writeSf3(folded, [Uint8Array.of(0, 0)], trimPlan(folded, 60, 0.05)), { reservedBank: 301 });
    expect(after.ok && after.report.covered.map((c) => c.program)).toEqual([30]);
  });
});
