import { describe, expect, it } from 'vitest';
import * as alphaTab from '@coderline/alphatab';
import { FONT_SUBSTITUTES, playableProgram, substituteUnplayablePrograms } from '../../src/audio/font-substitutes';

const Instrument = alphaTab.model.AutomationType.Instrument;
const Tempo = alphaTab.model.AutomationType.Tempo;

function track(program: number, laterInstrument?: number, isPercussion = false) {
  const opening = { type: Instrument, value: program };
  const tempo = { type: Tempo, value: 1 };
  const beats = [{ automations: [opening, tempo] }];
  const later = laterInstrument === undefined ? undefined : { type: Instrument, value: laterInstrument };
  if (later) beats.push({ automations: [later] } as never);
  return { isPercussion, playbackInfo: { program }, staves: [{ bars: [{ voices: [{ beats }] }] }], opening, later, tempo };
}

const scoreOf = (...tracks: ReturnType<typeof track>[]) => ({ tracks }) as unknown as alphaTab.model.Score;

describe('playableProgram', () => {
  it('swaps the pianos and the rain effect and leaves every other program as it is', () => {
    expect(playableProgram(0)).toBe(2);
    expect(playableProgram(1)).toBe(2);
    expect(playableProgram(3)).toBe(2);
    expect(playableProgram(96)).toBe(88);
    for (const program of [2, 4, 24, 30, 33, 48, 118]) expect(playableProgram(program)).toBe(program);
    expect(Object.keys(FONT_SUBSTITUTES).map(Number)).toEqual([0, 1, 3, 96]);
  });
});

describe('substituteUnplayablePrograms', () => {
  it('changes the track program and the instrument changes in its beats', () => {
    const piano = track(0, 1);
    expect(substituteUnplayablePrograms(scoreOf(piano))).toBe(1);
    expect(piano.playbackInfo.program).toBe(2);
    expect(piano.opening.value).toBe(2);
    expect(piano.later!.value).toBe(2);
  });

  it('leaves other tracks, other automations and percussion alone', () => {
    const guitar = track(30);
    const drums = track(0, undefined, true);
    const piano = track(1);
    expect(substituteUnplayablePrograms(scoreOf(guitar, drums, piano))).toBe(1);
    expect(guitar.playbackInfo.program).toBe(30);
    expect(guitar.opening.value).toBe(30);
    expect(drums.playbackInfo.program).toBe(0);
    expect(drums.opening.value).toBe(0);
    expect(piano.tempo.value).toBe(1);
  });

  it('changes a track that only switches to a piano partway through', () => {
    const track1 = track(30, 3);
    expect(substituteUnplayablePrograms(scoreOf(track1))).toBe(1);
    expect(track1.playbackInfo.program).toBe(30);
    expect(track1.later!.value).toBe(2);
  });

  it('does nothing to a score with nothing to swap', () => {
    expect(substituteUnplayablePrograms(scoreOf(track(30), track(33)))).toBe(0);
  });
});
