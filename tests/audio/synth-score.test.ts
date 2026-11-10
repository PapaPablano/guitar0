import { describe, expect, it, vi } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import { buildTimeline, loadAlphaTex, loadScoreFromBytes } from '../../src/model/alphatab-adapter';
import { buildSynthScore, type SynthScore } from '../../src/audio/synth-score';
import { SynthClock } from '../../src/audio/synth-bridge';
import { programGain } from '../../src/audio/track-balance';
import type { MutedPresets } from '../../src/audio/guitar-tone';
import { substituteUnplayablePrograms } from '../../src/audio/font-substitutes';
import { MUSICXML_WITH_TAB, REPEAT_AND_TEMPO, STEADY, TECHNIQUES, TWO_TRACKS } from '../fixtures/fixtures';

/** Every MIDI event alphaTab generates for a score, live and in export alike. */
function midiEvents(score: alphaTab.model.Score): alphaTab.midi.MidiEvent[] {
  const file = new alphaTab.midi.MidiFile();
  new alphaTab.midi.MidiFileGenerator(score, new alphaTab.Settings(), new alphaTab.midi.AlphaSynthMidiFileHandler(file)).generate();
  return file.events;
}

interface Sounded {
  tick: number;
  track: number;
  channel: number;
  key: number;
  program: number;
  bank: number;
}

/**
 * Each note-on with the program and bank its channel plays at that moment, replaying bank selects and program changes the
 * way alphaTab's synth does: a bank select only takes effect at the next program change, and melodic banks read `& 2047`.
 */
function sounded(score: alphaTab.model.Score): Sounded[] {
  const channels = new Map<number, { register: number; program: number; bank: number }>();
  const channel = (c: number) => {
    let state = channels.get(c);
    if (!state) channels.set(c, (state = { register: 0, program: 0, bank: 0 }));
    return state;
  };
  const out: Sounded[] = [];
  for (const e of midiEvents(score)) {
    if (e instanceof alphaTab.midi.ControlChangeEvent) {
      const c = channel(e.channel);
      if (e.controller === alphaTab.midi.ControllerType.BankSelectCoarse) c.register = (32768 | e.value) & 0xffff;
      if (e.controller === alphaTab.midi.ControllerType.BankSelectFine) c.register = (((c.register & 32768) !== 0 ? (c.register & 127) << 7 : 0) | e.value) & 0xffff;
    } else if (e instanceof alphaTab.midi.ProgramChangeEvent) {
      const c = channel(e.channel);
      c.program = e.program;
      c.bank = c.register & 2047;
    } else if (e instanceof alphaTab.midi.NoteOnEvent) {
      const c = channel(e.channel);
      out.push({ tick: e.tick, track: e.track, channel: e.channel, key: e.noteKey, program: c.program, bank: c.bank });
    }
  }
  return out;
}

const plain = (events: alphaTab.midi.MidiEvent[]) => events.map((e) => ({ kind: e.constructor.name, ...JSON.parse(JSON.stringify(e)) }));
const keyAt = (n: Sounded) => `${n.tick}:${n.key}`;

/** Four beats on a distortion guitar: two palm-muted chugs, then two open notes. */
const DISTORTION = String.raw`\title "chugs" \tempo 120 \track "Rhythm" \instrument 30 :4 0.6{pm} 0.6{pm} 3.5 5.4`;
/** A chord whose two low strings are palm-muted and whose third string rings open. */
const MIXED_CHORD = String.raw`\title "mixed" \tempo 120 \track "Rhythm" \instrument 30 :4 (0.6{pm} 2.5{pm} 2.4).4 3.3 3.3 3.3`;
/** A bent open note next to a palm mute. */
const BEND_AND_MUTE = String.raw`\title "bend" \tempo 120 \track "Lead" \instrument 30 :4 7.2{b (0 4)} 5.3{pm} 5.3{pm} 7.2`;
/** A track opening clean on beat 1, then changing to distortion in bar 2, with palm mutes in both bars. */
const CLEAN_THEN_DISTORTION = String.raw`\title "change" \tempo 120 \track "Rhythm" \instrument 27 :4 0.6{pm} 0.6{pm} 3.5 3.5 | 0.6{pm}.4{instrument 30} 0.6{pm} 3.5 3.5`;
/** A palm-muted note tied into an unmarked one: the tie belongs to the muted part. */
const TIED_MUTE = String.raw`\title "tie" \tempo 120 \track "Rhythm" \instrument 30 :4 0.6{pm} -.6 3.5 3.5`;
/** Two guitars: one with palm mutes, one without, then a bass. */
const BAND = String.raw`\title "band" \tempo 120 \track "Rhythm" \instrument 30 :4 0.6{pm} 0.6{pm} 3.5 5.4 \track "Lead" \instrument 27 :4 7.2 7.2 7.2 7.2 \track "Bass" \instrument 33 :4 0.4 0.4 0.4 0.4`;

/** `count` tracks in alphaTex, each a distortion guitar; those listed in `muted` play palm mutes. alphaTex gives every track two channels. */
function tracks(count: number, muted: readonly number[]): string {
  const body = Array.from({ length: count }, (_, i) => `\\track "T${i}" \\instrument 30 :4 ${muted.includes(i) ? '0.6{pm} 0.6{pm}' : '0.6 0.6'} 3.5 3.5`).join(' ');
  return `\\title "many" \\tempo 120 ${body}`;
}

const DISTORTION_MUTE: MutedPresets = { distortion: { bank: 300, program: 30 } };

describe('buildSynthScore: palm mutes move to a companion part (KTD4)', () => {
  it('AE1: a distortion track plays its chugs on a new channel with the shared muted sound, and its open notes at 30', () => {
    const original = loadAlphaTex(DISTORTION);
    const synth = buildSynthScore(original);
    expect(synth.score).not.toBe(original);
    expect(synth.companions).toEqual([{ index: 1, parent: 0 }]);
    const parent = synth.score.tracks[0];
    const companion = synth.score.tracks[1];
    expect(companion.playbackInfo.primaryChannel).toBe(companion.playbackInfo.secondaryChannel);
    const used = [parent.playbackInfo.primaryChannel, parent.playbackInfo.secondaryChannel, 9, 16];
    expect(used).not.toContain(companion.playbackInfo.primaryChannel);
    const notes = sounded(synth.score);
    const onParent = notes.filter((n) => n.track === 0);
    const onCompanion = notes.filter((n) => n.track === 1);
    expect(onParent.map((n) => n.tick)).toEqual([1920, 2880]);
    expect(onParent.every((n) => n.program === 30 && n.bank === 0)).toBe(true);
    expect(onCompanion.map((n) => n.tick)).toEqual([0, 960]);
    expect(onCompanion.every((n) => n.program === 28 && n.bank === 0 && n.channel === companion.playbackInfo.primaryChannel)).toBe(true);
  });

  it('AE2: with a distorted palm-mute preset in the active banks, the chugs select its bank and play it', () => {
    const synth = buildSynthScore(loadAlphaTex(DISTORTION), DISTORTION_MUTE);
    const channel = synth.score.tracks[1].playbackInfo.primaryChannel;
    const onCompanion = sounded(synth.score).filter((n) => n.track === 1);
    expect(onCompanion.length).toBe(2);
    expect(onCompanion.every((n) => n.program === 30 && n.bank === 300)).toBe(true);
    const selects = midiEvents(synth.score).filter(
      (e): e is alphaTab.midi.ControlChangeEvent =>
        e instanceof alphaTab.midi.ControlChangeEvent && e.channel === channel && e.controller === alphaTab.midi.ControllerType.BankSelectCoarse,
    );
    expect(selects.some((e) => e.value === 300 >> 7)).toBe(true);
    // The open notes are untouched by the muted preset.
    expect(sounded(synth.score).filter((n) => n.track === 0).every((n) => n.program === 30 && n.bank === 0)).toBe(true);
  });

  it('gives a track with no palm mutes no companion', () => {
    const synth = buildSynthScore(loadAlphaTex(BAND));
    expect(synth.score.tracks.length).toBe(4);
    expect(synth.companions).toEqual([{ index: 3, parent: 0 }]);
  });

  it('splits a chord mixing muted and open strings so each note sounds exactly once, at the same tick', () => {
    const original = loadAlphaTex(MIXED_CHORD);
    const before = sounded(original).filter((n) => n.tick === 0);
    expect(before.length).toBe(3);
    const after = sounded(buildSynthScore(original).score).filter((n) => n.tick === 0);
    expect(after.map(keyAt).sort()).toEqual(before.map(keyAt).sort());
    const open = after.filter((n) => n.track === 0);
    const muted = after.filter((n) => n.track === 1);
    expect(open.length).toBe(1);
    expect(muted.length).toBe(2);
    // The open note is the third string (D3, 2nd fret = E3, 52); the muted ones are the two lowest.
    expect(open[0].key).toBe(52);
  });

  it('plays every note of the original exactly once across parent and companion', () => {
    for (const tex of [DISTORTION, MIXED_CHORD, BEND_AND_MUTE, CLEAN_THEN_DISTORTION, TECHNIQUES, TIED_MUTE, BAND]) {
      const original = loadAlphaTex(tex);
      const before = sounded(original).map(keyAt).sort();
      const after = sounded(buildSynthScore(original).score).map(keyAt).sort();
      expect(after).toEqual(before);
    }
  });

  it('keeps a tie with the palm-muted note it starts from', () => {
    const synth = buildSynthScore(loadAlphaTex(TIED_MUTE));
    const onCompanion = sounded(synth.score).filter((n) => n.track === 1);
    expect(onCompanion.map((n) => n.tick)).toEqual([0]);
    const tied = synth.score.tracks[1].staves[0].bars[0].voices[0].beats[1].notes[0];
    expect(tied.isTieDestination).toBe(true);
    expect(tied.tieOrigin).toBe(synth.score.tracks[1].staves[0].bars[0].voices[0].beats[0].notes[0]);
    expect(synth.score.tracks[0].staves[0].bars[0].voices[0].beats[1].isRest).toBe(true);
  });

  it('turns beats left without notes into rests', () => {
    const synth = buildSynthScore(loadAlphaTex(DISTORTION));
    const parentBeats = synth.score.tracks[0].staves[0].bars[0].voices[0].beats;
    const companionBeats = synth.score.tracks[1].staves[0].bars[0].voices[0].beats;
    expect(parentBeats.map((b) => b.isRest)).toEqual([true, true, false, false]);
    expect(companionBeats.map((b) => b.isRest)).toEqual([false, false, true, true]);
    // Bars, beats and timing are identical, so the two parts cannot drift.
    expect(companionBeats.map((b) => b.playbackStart)).toEqual(parentBeats.map((b) => b.playbackStart));
  });

  it('generates MIDI identical to the original, event for event, when a score has no palm mutes', () => {
    const loaders = [
      () => loadAlphaTex(STEADY),
      () => loadAlphaTex(REPEAT_AND_TEMPO),
      () => loadAlphaTex(TWO_TRACKS),
      () => loadAlphaTex(TECHNIQUES.replace('{pm}', '')),
      () => loadAlphaTex(BAND.replace(/\{pm\}/g, '')),
      () => loadScoreFromBytes(new TextEncoder().encode(MUSICXML_WITH_TAB)),
    ];
    for (const load of loaders) {
      const synth = buildSynthScore(load());
      expect(synth.companions).toEqual([]);
      // The copy has the font's unplayable sounds swapped (MusicXML's piano default here), so the reference does too.
      const reference = load();
      substituteUnplayablePrograms(reference);
      expect(plain(midiEvents(synth.score))).toEqual(plain(midiEvents(reference)));
    }
  });

  it('gives a companion the clean muted preset, then the distortion one, across a beat-1 instrument and a mid-song change', () => {
    const presets: MutedPresets = { clean: { bank: 300, program: 27 }, distortion: { bank: 301, program: 30 } };
    const onCompanion = sounded(buildSynthScore(loadAlphaTex(CLEAN_THEN_DISTORTION), presets).score).filter((n) => n.track === 1);
    expect(onCompanion.map((n) => [n.tick, n.program, n.bank])).toEqual([
      [0, 27, 300],
      [960, 27, 300],
      [3840, 30, 301],
      [4800, 30, 301],
    ]);
    // With no tone-matched mutes, both segments play the shared muted sound at bank 0.
    const shared = sounded(buildSynthScore(loadAlphaTex(CLEAN_THEN_DISTORTION)).score).filter((n) => n.track === 1);
    expect(shared.every((n) => n.program === 28 && n.bank === 0)).toBe(true);
    // The parent still changes from clean to distortion as written.
    const parent = sounded(buildSynthScore(loadAlphaTex(CLEAN_THEN_DISTORTION), presets).score).filter((n) => n.track === 0);
    expect(parent.map((n) => n.program)).toEqual([27, 27, 30, 30]);
    expect(parent.every((n) => n.bank === 0)).toBe(true);
  });

  it('keeps a bent note on the parent, with its program and channel', () => {
    const original = loadAlphaTex(BEND_AND_MUTE);
    const synth = buildSynthScore(original);
    const bentBefore = sounded(original).find((n) => n.tick === 0)!;
    const bentAfter = sounded(synth.score).find((n) => n.tick === 0)!;
    expect(bentAfter.track).toBe(0);
    expect(bentAfter.channel).toBe(bentBefore.channel);
    expect(bentAfter.program).toBe(30);
    const bends = (score: alphaTab.model.Score) =>
      plain(midiEvents(score).filter((e) => e instanceof alphaTab.midi.NoteBendEvent && e.channel === bentBefore.channel && e.tick < 960));
    expect(bends(synth.score)).toEqual(bends(original));
  });

  it("keeps a steel acoustic's palm mutes on program 25", () => {
    const original = loadAlphaTex(TECHNIQUES);
    expect(original.tracks[0].playbackInfo.program).toBe(25);
    const synth = buildSynthScore(original, DISTORTION_MUTE);
    expect(synth.companions).toEqual([{ index: 1, parent: 0 }]);
    const onCompanion = sounded(synth.score).filter((n) => n.track === 1);
    expect(onCompanion.length).toBe(1);
    expect(onCompanion[0].program).toBe(25);
    expect(onCompanion[0].bank).toBe(0);
  });

  it('gives no companions to a score with no unused channel in 0 to 15, and keeps the short palm mutes', () => {
    const original = loadAlphaTex(tracks(8, [0, 3]));
    const synth = buildSynthScore(original);
    expect(synth.companions).toEqual([]);
    expect(synth.score.tracks.length).toBe(8);
    expect(plain(midiEvents(synth.score))).toEqual(plain(midiEvents(original)));
  });

  it('gives companions only while free channels last, never 9 or a used one', () => {
    const original = loadAlphaTex(tracks(7, [1, 4, 6]));
    const used = new Set(original.tracks.flatMap((t) => [t.playbackInfo.primaryChannel, t.playbackInfo.secondaryChannel]));
    const free = [...Array(16).keys()].filter((c) => c !== 9 && !used.has(c));
    const synth = buildSynthScore(original);
    expect(synth.companions.length).toBe(Math.min(3, free.length));
    expect(synth.companions.map((c) => c.parent)).toEqual([1, 4, 6].slice(0, free.length));
    const channels = synth.companions.map((c) => synth.score.tracks[c.index].playbackInfo.primaryChannel);
    expect(channels).toEqual(free.slice(0, channels.length));
    expect(channels).not.toContain(9);
  });

  it("leaves the original score's tracks and notes untouched, so the timeline is unchanged", () => {
    const original = loadAlphaTex(BAND);
    const timeline = buildTimeline(original);
    const notes = (score: alphaTab.model.Score) =>
      score.tracks.map((t) => t.staves[0].bars.flatMap((b) => b.voices.flatMap((v) => v.beats.flatMap((beat) => beat.notes.map((n) => [n.fret, n.string, n.isPalmMute])))));
    const before = notes(original);
    const synth = buildSynthScore(original, DISTORTION_MUTE);
    const clock = clockOver(synth).clock;
    clock.setTrackPrograms(new Map([[0, 27]]));
    expect(original.tracks.length).toBe(3);
    expect(notes(original)).toEqual(before);
    expect(original.tracks[0].playbackInfo.program).toBe(30);
    const after = buildTimeline(original);
    expect(after.tracks).toEqual(timeline.tracks);
    expect(after.bars).toEqual(timeline.bars);
    for (const track of timeline.tracks) expect(after.notesForTrack(track.index)).toEqual(timeline.notesForTrack(track.index));
  });

  it('swaps unplayable programs on the copy, not on the loaded score', () => {
    const original = loadAlphaTex(STEADY);
    // A grand piano, which the font stores in stereo halves.
    original.tracks[0].playbackInfo.program = 0;
    for (const beat of original.tracks[0].staves[0].bars[0].voices[0].beats)
      for (const automation of beat.automations) if (automation.type === alphaTab.model.AutomationType.Instrument) automation.value = 0;
    const synth = buildSynthScore(original);
    expect(original.tracks[0].playbackInfo.program).toBe(0);
    expect(synth.score.tracks[0].playbackInfo.program).toBe(2);
  });

  it('clones a large score quickly', () => {
    const bars = Array.from({ length: 300 }, () => '0.6{pm} 0.6{pm} 3.5 (0.6 2.5 2.4)').join(' | ');
    const body = Array.from({ length: 6 }, (_, i) => `\\track "T${i}" \\instrument 30 :8 ${bars}`).join(' ');
    const original = loadAlphaTex(`\\title "large" \\tempo 120 ${body}`);
    const started = performance.now();
    const synth = buildSynthScore(original, DISTORTION_MUTE);
    const elapsed = performance.now() - started;
    console.info(`synth score clone: ${original.tracks.length} tracks x ${original.masterBars.length} bars in ${elapsed.toFixed(1)} ms`);
    // Six tracks take channels 0 to 11, leaving 12 to 15 for four companions.
    expect(synth.companions.length).toBe(4);
    expect(elapsed).toBeLessThan(3000);
  });
});

type Handler<T> = (e: T) => void;

function emitter<T>(fireOnRegister = false) {
  const handlers: Handler<T>[] = [];
  return {
    on: (h: Handler<T>) => {
      handlers.push(h);
      if (fireOnRegister) (h as () => void)();
      return () => handlers.splice(handlers.indexOf(h), 1);
    },
    emit: (e: T) => [...handlers].forEach((h) => h(e)),
  };
}

/** A SynthClock over a fake alphaTab api that holds the real synth score, recording mutes, levels and exports. */
function clockOver(synth: SynthScore, presets: MutedPresets = {}) {
  const ready = emitter<void>(false);
  const exported: { programs: number[]; trackVolume: Map<number, number> }[] = [];
  const api = {
    playerPositionChanged: emitter<{ currentTick: number }>(),
    playerStateChanged: emitter<{ state: number }>(),
    playerReady: ready,
    play: vi.fn(),
    pause: vi.fn(),
    destroy: vi.fn(),
    tickPosition: 0,
    playbackSpeed: 1,
    playbackRange: null as unknown,
    isLooping: false,
    score: synth.score,
    loadMidiForScore: vi.fn(),
    changeTrackMute: vi.fn(),
    changeTrackVolume: vi.fn(),
    exportAudio: vi.fn(async (options: { trackVolume: Map<number, number> }) => {
      exported.push({ programs: synth.score.tracks.map((t) => t.playbackInfo.program), trackVolume: new Map(options.trackVolume) });
      return { render: async () => null, destroy: vi.fn() };
    }),
  };
  const clock = new SynthClock(api as unknown as alphaTab.AlphaTabApi, 60, [{ tick: 0, tempo: 120 }], 0);
  clock.useCompanions(synth.companions, presets);
  return { api, clock, ready, exported };
}

describe('SynthClock with companion parts', () => {
  it('re-sets the companion when the parent switches from Distortion to Clean, and never to a written parent sound', () => {
    const presets: MutedPresets = { clean: { bank: 300, program: 27 } };
    const synth = buildSynthScore(loadAlphaTex(DISTORTION), presets);
    const { clock, api } = clockOver(synth, presets);
    clock.setTrackPrograms(new Map([[0, 27]]));
    expect(api.loadMidiForScore).toHaveBeenCalledTimes(1);
    let onCompanion = sounded(synth.score).filter((n) => n.track === 1);
    expect(onCompanion.every((n) => n.program === 27 && n.bank === 300)).toBe(true);
    expect(sounded(synth.score).filter((n) => n.track === 0).every((n) => n.program === 27 && n.bank === 0)).toBe(true);

    // Clearing the tone puts the parent back to distortion; the companion follows it to the shared muted sound.
    clock.setTrackPrograms(new Map());
    onCompanion = sounded(synth.score).filter((n) => n.track === 1);
    expect(onCompanion.every((n) => n.program === 28 && n.bank === 0)).toBe(true);
    expect(sounded(synth.score).filter((n) => n.track === 0).every((n) => n.program === 30)).toBe(true);
  });

  it('switching to Clean with no clean mutes plays the shared muted sound', () => {
    const synth = buildSynthScore(loadAlphaTex(DISTORTION), DISTORTION_MUTE);
    const { clock } = clockOver(synth, DISTORTION_MUTE);
    expect(sounded(synth.score).filter((n) => n.track === 1).every((n) => n.program === 30 && n.bank === 300)).toBe(true);
    clock.setTrackPrograms(new Map([[0, 27]]));
    expect(sounded(synth.score).filter((n) => n.track === 1).every((n) => n.program === 28 && n.bank === 0)).toBe(true);
  });

  it('ignores a tone chosen for a companion index', () => {
    const synth = buildSynthScore(loadAlphaTex(DISTORTION));
    const { clock, api } = clockOver(synth);
    clock.setTrackPrograms(new Map([[1, 27]]));
    expect(api.loadMidiForScore).not.toHaveBeenCalled();
    expect(synth.score.tracks[1].playbackInfo.program).toBe(28);
  });

  it("silences the parent's companion too when the parent is the play-along track, live and in export", async () => {
    const synth = buildSynthScore(loadAlphaTex(BAND));
    const { clock, api, ready, exported } = clockOver(synth);
    const [rhythm, , , companion] = synth.score.tracks;
    clock.setSilentTrack(0);
    expect(api.changeTrackMute).toHaveBeenCalledWith([rhythm, companion], true);
    api.changeTrackMute.mockClear();
    ready.emit();
    expect(api.changeTrackMute).toHaveBeenCalledWith([rhythm, companion], true);
    await clock.exportAudio(undefined, { effects: false });
    expect(exported[0].trackVolume.get(0)).toBe(0);
    expect(exported[0].trackVolume.get(3)).toBe(0);
    expect(exported[0].trackVolume.get(1)).not.toBe(0);
    // Moving the silence to another track brings the companion back.
    api.changeTrackMute.mockClear();
    clock.setSilentTrack(1);
    expect(api.changeTrackMute).toHaveBeenCalledWith([rhythm, companion], false);
    expect(api.changeTrackMute).toHaveBeenCalledWith([synth.score.tracks[1]], true);
  });

  it("records a palm-muted track's companion at a non-zero volume in an onlyTrack export", async () => {
    const synth = buildSynthScore(loadAlphaTex(BAND));
    const { clock, exported } = clockOver(synth);
    await clock.exportAudio(undefined, { onlyTrack: 0, effects: false });
    const volumes = exported[0].trackVolume;
    expect(volumes.get(1)).toBe(0);
    expect(volumes.get(2)).toBe(0);
    expect(volumes.get(3) ?? 1).toBeGreaterThan(0);
    expect(volumes.get(0) ?? 1).toBeGreaterThan(0);
  });

  it('records the companion with its muted program in the export', async () => {
    const synth = buildSynthScore(loadAlphaTex(BAND));
    const { clock, exported } = clockOver(synth);
    await clock.exportAudio(undefined, { effects: false });
    expect(exported[0].programs).toEqual([30, 27, 33, 28]);
  });

  it("gives a distortion parent's companion the muted sound's level gain, live and in export", async () => {
    for (const presets of [{}, DISTORTION_MUTE] as MutedPresets[]) {
      const synth = buildSynthScore(loadAlphaTex(DISTORTION), presets);
      const { clock, api, ready, exported } = clockOver(synth, presets);
      ready.emit();
      const [parent, companion] = synth.score.tracks;
      expect(api.changeTrackVolume).toHaveBeenCalledWith([parent], programGain(30));
      expect(api.changeTrackVolume).toHaveBeenCalledWith([companion], programGain(28));
      expect(programGain(28)).not.toBe(programGain(30));
      await clock.exportAudio(undefined, { effects: false });
      expect(exported[0].trackVolume.get(1)).toBe(programGain(28));
      expect(exported[0].trackVolume.get(0)).toBe(programGain(30));
    }
  });
});
