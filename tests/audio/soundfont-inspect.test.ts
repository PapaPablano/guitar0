import { describe, expect, it } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import { DISABLED_BANK, filterBank, type FilterResult } from '../../src/audio/soundfont-inspect';
import {
  buildSoundFont,
  instrumentChunks,
  readPresets,
  riffSizeMatches,
  sampleData,
  type FixturePreset,
} from '../fixtures/soundfonts';

const RESERVED = 101;

function filtered(presets: readonly FixturePreset[], reservedBank = RESERVED) {
  const result = filterBank(buildSoundFont(presets), { reservedBank });
  if (!result.ok) throw new Error(`expected success, got: ${result.reason}`);
  return result;
}

function presetNamed(bytes: Uint8Array, name: string) {
  return readPresets(bytes).filter((p) => p.name === name);
}

const GUITAR_AND_BASS: FixturePreset[] = [
  { name: 'Piano', bank: 0, program: 0, samples: ['mono', 'mono'] },
  { name: 'Clean Gtr', bank: 0, program: 27, samples: ['mono', 'mono'] },
  { name: 'Dist Gtr Stereo', bank: 0, program: 30, samples: ['left', 'right'] },
  { name: 'Finger Bass', bank: 0, program: 33, samples: ['mono-ogg'] },
  { name: 'Standard Kit', bank: 128, program: 0, samples: ['mono', 'mono', 'mono'] },
];

describe('filterBank', () => {
  it('reports mono guitar and bass presets as covered and leaves them at bank 0', () => {
    const { bytes, report } = filtered(GUITAR_AND_BASS);
    expect(report.covered).toEqual([
      { program: 27, name: 'Clean Gtr' },
      { program: 33, name: 'Finger Bass' },
    ]);
    const [clean] = presetNamed(bytes, 'Clean Gtr');
    expect(clean).toMatchObject({ bank: 0, program: 27 });
    expect(clean.sampleIds.length).toBe(2);
    const [bass] = presetNamed(bytes, 'Finger Bass');
    expect(bass).toMatchObject({ bank: 0, program: 33 });
    expect(bass.sampleIds.length).toBe(1);
  });

  it('rejects a stereo-only preset and moves it off bank 0 with nothing reachable', () => {
    const { bytes, report } = filtered(GUITAR_AND_BASS);
    expect(report.rejected).toContainEqual({ program: 30, reason: 'stereo', name: 'Dist Gtr Stereo' });
    const [dist] = presetNamed(bytes, 'Dist Gtr Stereo');
    expect(dist.bank).toBe(DISABLED_BANK);
    expect(dist.sampleIds).toEqual([]);
    expect(report.covered.map((c) => c.program)).not.toContain(30);
  });

  it('reports every uncovered guitar or bass program as missing', () => {
    const { report } = filtered(GUITAR_AND_BASS);
    const missing = report.rejected.filter((r) => r.reason === 'missing').map((r) => r.program);
    expect(missing).toEqual([24, 25, 26, 28, 29, 31, 32, 34]);
  });

  it('moves a piano and a drum kit off banks 0 and 128 with no sample reachable from them', () => {
    const { bytes, report } = filtered(GUITAR_AND_BASS);
    for (const name of ['Piano', 'Standard Kit']) {
      const [preset] = presetNamed(bytes, name);
      expect(preset.bank).not.toBe(0);
      expect(preset.bank).not.toBe(128);
      expect(preset.sampleIds).toEqual([]);
    }
    expect(report.disabled).toContainEqual({ name: 'Piano', bank: 0, program: 0, reason: 'unused' });
    expect(report.disabled).toContainEqual({ name: 'Standard Kit', bank: 128, program: 0, reason: 'unused' });
    // Nothing left in the copy sits at bank 0 except the kept presets, and nothing at all sits at bank 128.
    const atZero = readPresets(bytes).filter((p) => p.bank === 0).map((p) => p.name);
    expect(atZero.sort()).toEqual(['Clean Gtr', 'Finger Bass']);
    expect(readPresets(bytes).some((p) => p.bank === 128)).toBe(false);
  });

  it('moves guitar presets on other banks off them too', () => {
    const { bytes, report } = filtered([{ name: 'Clean Var', bank: 8, program: 27, samples: ['mono'] }]);
    expect(report.covered).toEqual([]);
    const [preset] = presetNamed(bytes, 'Clean Var');
    expect(preset.bank).toBe(DISABLED_BANK);
    expect(preset.sampleIds).toEqual([]);
  });

  it('reports no covered programs for a piano-only bank (AE3)', () => {
    const { report } = filtered([
      { name: 'Grand Piano', bank: 0, program: 0, samples: ['mono'] },
      { name: 'Bright Piano', bank: 0, program: 1, samples: ['mono', 'mono'] },
    ]);
    expect(report.covered).toEqual([]);
    expect(report.mutedCandidates).toEqual([]);
    expect(report.rejected.every((r) => r.reason === 'missing')).toBe(true);
    expect(report.rejected.map((r) => r.program)).toEqual([24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34]);
  });

  it('turns a mono palm-mute preset into a muted candidate for its tone at the reserved bank', () => {
    const { bytes, report } = filtered([
      { name: 'Clean Gtr', bank: 0, program: 27, samples: ['mono'] },
      { name: 'Dist Palm Mute', bank: 3, program: 12, samples: ['mono', 'mono'] },
    ]);
    expect(report.mutedCandidates).toEqual([{ tone: 'distortion', bank: RESERVED, program: 30, name: 'Dist Palm Mute' }]);
    const [muted] = presetNamed(bytes, 'Dist Palm Mute');
    expect(muted).toMatchObject({ bank: RESERVED, program: 30 });
    expect(muted.sampleIds.length).toBe(2);
  });

  it('matches the tone words of the muted rule case-insensitively', () => {
    const { report } = filtered([
      { name: 'CLEAN MUTED', bank: 1, program: 1, samples: ['mono'] },
      { name: 'overdrive palm', bank: 1, program: 2, samples: ['mono'] },
      { name: 'Crunch Mute', bank: 1, program: 3, samples: ['mono'] },
      { name: 'Palm Mute', bank: 1, program: 4, samples: ['mono'] }, // no tone word
      { name: 'Distortion', bank: 1, program: 5, samples: ['mono'] }, // no mute word
    ]);
    expect(report.mutedCandidates).toEqual([
      { tone: 'clean', bank: RESERVED, program: 27, name: 'CLEAN MUTED' },
      { tone: 'crunch', bank: RESERVED, program: 29, name: 'overdrive palm' },
    ]);
    expect(report.disabled).toContainEqual({ name: 'Crunch Mute', bank: 1, program: 3, reason: 'duplicate' });
  });

  it('rejects a stereo palm-mute preset', () => {
    const { bytes, report } = filtered([{ name: 'Dist Palm Mute', bank: 0, program: 90, samples: ['left-ogg', 'right-ogg'] }]);
    expect(report.mutedCandidates).toEqual([]);
    expect(report.disabled).toContainEqual({ name: 'Dist Palm Mute', bank: 0, program: 90, reason: 'stereo' });
    const [preset] = presetNamed(bytes, 'Dist Palm Mute');
    expect(preset.bank).toBe(DISABLED_BANK);
    expect(preset.sampleIds).toEqual([]);
  });

  it('keeps a covered preset whose name is also a palm mute in both places', () => {
    const { bytes, report } = filtered([{ name: 'Clean Palm Mute', bank: 0, program: 28, samples: ['mono'] }]);
    expect(report.covered).toEqual([{ program: 28, name: 'Clean Palm Mute' }]);
    expect(report.mutedCandidates).toEqual([{ tone: 'clean', bank: RESERVED, program: 27, name: 'Clean Palm Mute' }]);
    const copies = presetNamed(bytes, 'Clean Palm Mute');
    expect(copies.map((p) => [p.bank, p.program, p.sampleIds.length])).toEqual([
      [0, 28, 1],
      [RESERVED, 27, 1],
    ]);
  });

  it('treats a preset mixing mono and stereo samples as stereo', () => {
    const { report } = filtered([{ name: 'Steel', bank: 0, program: 25, samples: ['mono', 'linked'] }]);
    expect(report.covered).toEqual([]);
    expect(report.rejected).toContainEqual({ program: 25, reason: 'stereo', name: 'Steel' });
  });

  it('reports a bank 0 guitar preset with no sample zones as missing, by name', () => {
    const { bytes, report } = filtered([{ name: 'Empty Jazz', bank: 0, program: 26, samples: [] }]);
    expect(report.rejected).toContainEqual({ program: 26, reason: 'missing', name: 'Empty Jazz' });
    expect(presetNamed(bytes, 'Empty Jazz')[0]).toMatchObject({ bank: DISABLED_BANK, sampleIds: [] });
  });

  it('keeps the first of two bank 0 presets for the same program', () => {
    const { bytes, report } = filtered([
      { name: 'Nylon A', bank: 0, program: 24, samples: ['mono'] },
      { name: 'Nylon B', bank: 0, program: 24, samples: ['mono'] },
    ]);
    expect(report.covered).toEqual([{ program: 24, name: 'Nylon A' }]);
    expect(presetNamed(bytes, 'Nylon B')[0]).toMatchObject({ bank: DISABLED_BANK, sampleIds: [] });
  });

  it('writes a copy that passes the RIFF size check, with sample data and instruments byte-identical', () => {
    const original = buildSoundFont(GUITAR_AND_BASS);
    const before = original.slice();
    const result = filterBank(original, { reservedBank: RESERVED });
    if (!result.ok) throw new Error(result.reason);
    expect(riffSizeMatches(result.bytes)).toBe(true);
    expect(result.bytes).not.toBe(original);
    expect(sampleData(result.bytes)).toEqual(sampleData(original));
    expect(sampleData(result.bytes).length).toBeGreaterThan(0);
    expect(instrumentChunks(result.bytes)).toEqual(instrumentChunks(original));
    expect(original).toEqual(before); // the input is not modified
  });

  it('accepts the filtered copy as its own input and changes nothing more', () => {
    const once = filtered(GUITAR_AND_BASS);
    const twice = filterBank(once.bytes, { reservedBank: RESERVED });
    if (!twice.ok) throw new Error(twice.reason);
    expect(twice.report.covered).toEqual(once.report.covered);
    expect(readPresets(twice.bytes)).toEqual(readPresets(once.bytes));
  });

  describe('failures', () => {
    const expectFailure = (result: FilterResult) => {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/\S/);
    };

    it('fails on non-RIFF bytes without throwing', () => {
      expectFailure(filterBank(new TextEncoder().encode('this is not a sound bank at all'), { reservedBank: RESERVED }));
      expectFailure(filterBank(new Uint8Array(0), { reservedBank: RESERVED }));
    });

    it('fails on a truncated file without throwing', () => {
      const whole = buildSoundFont(GUITAR_AND_BASS);
      for (const cut of [4, 12, 40, whole.length >> 1, whole.length - 30, whole.length - 1]) {
        expectFailure(filterBank(whole.subarray(0, cut), { reservedBank: RESERVED }));
      }
    });

    it('fails on a RIFF file with no preset data', () => {
      const bytes = new Uint8Array(12);
      bytes.set(new TextEncoder().encode('RIFF'), 0);
      new DataView(bytes.buffer).setUint32(4, 4, true);
      bytes.set(new TextEncoder().encode('sfbk'), 8);
      expectFailure(filterBank(bytes, { reservedBank: RESERVED }));
    });

    it('fails on damaged preset indices without throwing', () => {
      const bytes = buildSoundFont(GUITAR_AND_BASS);
      // Point the first preset's bag index far past the end of the bag list.
      const phdrAt = findChunk(bytes, 'phdr');
      new DataView(bytes.buffer).setUint16(phdrAt + 8 + 24, 60000, true);
      expectFailure(filterBank(bytes, { reservedBank: RESERVED }));
    });

    it('refuses a reserved bank that is 0, 128 or the disabled bank', () => {
      const bytes = buildSoundFont(GUITAR_AND_BASS);
      for (const reservedBank of [0, 128, DISABLED_BANK, -1, 2048, 1.5]) expectFailure(filterBank(bytes, { reservedBank }));
    });
  });
});

function findChunk(bytes: Uint8Array, id: string): number {
  for (let i = 0; i + 4 <= bytes.length; i++) {
    if (String.fromCharCode(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]) === id) return i;
  }
  throw new Error(`no ${id}`);
}

describe('filterBank output in a real alphaTab synth', () => {
  /** Peak level of a short note on one program at one bank, rendered by alphaTab's own exporter from the given banks. */
  function peak(banks: readonly Uint8Array[], program: number, bank = 0): number {
    const midi = new alphaTab.midi.MidiFile();
    midi.addEvent(new alphaTab.midi.ControlChangeEvent(0, 0, 0, alphaTab.midi.ControllerType.BankSelectCoarse, bank >> 7));
    midi.addEvent(new alphaTab.midi.ControlChangeEvent(0, 0, 0, alphaTab.midi.ControllerType.BankSelectFine, bank & 127));
    midi.addEvent(new alphaTab.midi.ProgramChangeEvent(0, 0, 0, program));
    midi.addEvent(new alphaTab.midi.NoteOnEvent(0, 10, 0, 5, 127));
    midi.addEvent(new alphaTab.midi.NoteOffEvent(0, 400, 0, 5, 0));
    midi.addEvent(new alphaTab.midi.EndOfTrackEvent(0, 960));
    const silentOutput = {
      sampleRate: 44100,
      ready: { on() {} },
      sampleRequest: { on() {} },
      samplesPlayed: { on() {} },
      open() {},
    };
    const synth = new alphaTab.synth.AlphaSynth(silentOutput as unknown as alphaTab.synth.ISynthOutput, 100);
    const options = new alphaTab.synth.AudioExportOptions();
    options.soundFonts = [...banks];
    const exporter = synth.exportAudio(options, midi, [], new Map());
    let max = 0;
    for (let i = 0; i < 4; i++) {
      const chunk = exporter.render(250);
      if (!chunk) break;
      for (const s of chunk.samples) max = Math.max(max, Math.abs(s));
    }
    return max;
  }

  it('plays the kept program and not the disabled ones', () => {
    const original = buildSoundFont(GUITAR_AND_BASS);
    const { bytes } = filtered(GUITAR_AND_BASS);
    // The unfiltered bank sounds for the piano, which shows the probe can hear it.
    expect(peak([original], 0)).toBeGreaterThan(0);
    expect(peak([bytes], 27)).toBeGreaterThan(0);
    expect(peak([bytes], 0)).toBe(0);
    expect(peak([bytes], 0, DISABLED_BANK)).toBe(0);
  });

  it('plays a muted candidate at its reserved bank and program', () => {
    const presets: FixturePreset[] = [{ name: 'Dist Palm Mute', bank: 3, program: 12, samples: ['mono'] }];
    const { bytes } = filtered(presets);
    expect(peak([bytes], 30, RESERVED)).toBeGreaterThan(0);
    expect(peak([bytes], 12, 3)).toBe(0);
  });
});
