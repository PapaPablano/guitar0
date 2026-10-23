import { describe, expect, it } from 'vitest';
import { BASS_PROFILE, NECK_PROFILE } from '../../src/render/neck-profile';
import { renderStageFrame, type FrameContext } from '../../src/render/stage-frame';
import { makeTimeline, makeTwoTrackTimeline } from '../helpers/make-timeline';
import { createRecordingContext, type Call } from '../helpers/recording-context';

const W = 1920;
const H = 1080;
const guitarPhoto = { tag: 'guitar' } as unknown as CanvasImageSource;
const bassPhoto = { tag: 'bass' } as unknown as CanvasImageSource;

const guitar = makeTimeline([{ start: 1, end: 2, string: 3, fret: 5 }, { start: 3, end: 4, string: 2, fret: 7 }], 2, 4, 6);
const bass = makeTimeline([{ start: 1, end: 2, string: 4, fret: 3 }, { start: 3, end: 4, string: 1, fret: 9 }], 2, 4, 4);
const band = makeTwoTrackTimeline(guitar, bass);

function frame(tracks: number | number[], panels: ('neck' | 'pick' | 'tab' | 'highway')[], photos: object = { photo: guitarPhoto, bassPhoto }, w = W, h = H): Call[] {
  const { ctx, calls } = createRecordingContext();
  renderStageFrame(ctx as unknown as FrameContext, band, tracks, 1.2, w, h, panels, { lookahead: 4, ...photos });
  return calls;
}

describe('a frame with a track for each panel', () => {
  it('covers AE1: draws a guitar neck over a bass track, each on its own photo and profile', () => {
    // the pick view on a 4-string track also draws on the bass photo, so a neck over a pick view shows both
    const calls = frame([0, 1], ['neck', 'pick']);
    const images = calls.filter((c) => c.name === 'drawImage');
    expect(images).toHaveLength(2);
    expect(images[0].args[0]).toBe(guitarPhoto);
    expect(images[0].args[3]).toBe(NECK_PROFILE.photoWidth);
    expect(images[1].args[0]).toBe(bassPhoto);
    expect(images[1].args[3]).toBe(BASS_PROFILE.photoWidth);
  });

  it('draws a different picture for another track in the bottom panel', () => {
    expect(frame([0, 1], ['tab', 'highway'])).not.toEqual(frame([0, 0], ['tab', 'highway']));
  });

  it('covers AE4: one track for every panel draws what a single track number does', () => {
    expect(frame([1, 1], ['tab', 'highway'])).toEqual(frame(1, ['tab', 'highway']));
    expect(frame([0, 0], ['neck', 'tab'])).toEqual(frame(0, ['neck', 'tab']));
  });

  it('draws highway beside tab in a portrait frame from a track per column', () => {
    const split = frame([0, 1], ['highway', 'tab'], {}, 1080, 1920);
    expect(split).not.toEqual(frame([0, 0], ['highway', 'tab'], {}, 1080, 1920));
    expect(frame([1, 1], ['highway', 'tab'], {}, 1080, 1920)).toEqual(frame(1, ['highway', 'tab'], {}, 1080, 1920));
  });

  it('falls back to the bass photo given as the only photo, as before', () => {
    const only = frame(1, ['neck'], { photo: bassPhoto }).filter((c) => c.name === 'drawImage');
    expect(only[0].args[0]).toBe(bassPhoto);
  });
});
