import { describe, expect, it } from 'vitest';
import { BASS_PROFILE, NECK_PROFILE } from '../../src/render/neck-profile';
import type { StartMessage } from '../../src/export/encoder.worker';
import { startExport } from '../../src/export/exporter';
import { photosNeeded } from '../../src/export/photos-needed';
import { presetById } from '../../src/export/presets';
import { hydrateTimeline, serializeTimeline } from '../../src/model/serialize';
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

describe('the photos a video needs', () => {
  it('covers AE1: a guitar neck over a 4-string track needs both photos', () => {
    expect(photosNeeded(['neck', 'neck'], [0, 1], band)).toEqual({ guitar: true, bass: true, pick: false });
  });

  it('asks for one photo kind when every panel draws the same track', () => {
    expect(photosNeeded(['neck', 'tab'], [0, 0], band)).toEqual({ guitar: true, bass: false, pick: false });
    expect(photosNeeded(['neck', 'tab'], [1, 1], band)).toEqual({ guitar: false, bass: true, pick: false });
  });

  it('sends a pick view of a 4-string track to the bass photo and any other to the pick photo', () => {
    expect(photosNeeded(['pick'], [1], band)).toEqual({ guitar: false, bass: true, pick: false });
    expect(photosNeeded(['pick'], [0], band)).toEqual({ guitar: false, bass: false, pick: true });
  });

  it('needs none for panels that draw no photo', () => {
    expect(photosNeeded(['highway', 'tab'], [0, 1], band)).toEqual({ guitar: false, bass: false, pick: false });
  });
});

describe('serializing for a track per panel', () => {
  it('round-trips the notes of every track given', () => {
    const data = structuredClone(serializeTimeline(band, [0, 1]));
    const back = hydrateTimeline(data);
    expect(back.notesForTrack(0)).toEqual(band.notesForTrack(0));
    expect(back.notesForTrack(1)).toEqual(band.notesForTrack(1));
  });

  it('keeps sending only the notes of one track for a single track number', () => {
    const data = serializeTimeline(band, 1);
    expect(Object.keys(data.notes)).toEqual(['1']);
  });
});

describe('a start message for a track per panel', () => {
  function start(extra: object): StartMessage {
    const posted: unknown[] = [];
    class FakeWorker {
      onmessage: unknown = null;
      onerror: unknown = null;
      postMessage(message: unknown) {
        posted.push(message);
      }
      terminate() {}
    }
    const original = (globalThis as { Worker?: unknown }).Worker;
    (globalThis as { Worker?: unknown }).Worker = FakeWorker;
    try {
      void startExport({
        timeline: band,
        trackIndex: 0,
        preset: presetById('landscape'),
        audio: { left: new Float32Array(48000), right: new Float32Array(48000), sampleRate: 48000 },
        panels: ['neck', 'tab'],
        view: { lookahead: 6 },
        onProgress: () => {},
        ...extra,
      }).result.catch(() => {});
    } finally {
      (globalThis as { Worker?: unknown }).Worker = original;
    }
    return posted[0] as StartMessage;
  }

  it('covers AE1: carries each panel track and the notes of both tracks', () => {
    const message = start({ panelTracks: [0, 1] });
    expect(message.panelTracks).toEqual([0, 1]);
    expect(Object.keys(message.data.notes).sort()).toEqual(['0', '1']);
  });

  it('covers AE4: without panel tracks it sends the one track as before', () => {
    const message = start({});
    expect(message.panelTracks).toBeUndefined();
    expect(Object.keys(message.data.notes)).toEqual(['0']);
  });
});
