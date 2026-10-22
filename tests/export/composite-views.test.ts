import { describe, expect, it } from 'vitest';
import type { StartMessage } from '../../src/export/encoder.worker';
import { AlignmentMap } from '../../src/audio/alignment-map';
import { startExport } from '../../src/export/exporter';
import { presetById } from '../../src/export/presets';
import type { PanelId } from '../../src/app/stage-layout';
import { computeNeck, renderFretboard } from '../../src/render/fretboard';
import { maxFretUsed } from '../../src/render/fretboard-steps';
import { frameLayout, renderStageFrame, type ExportViewOptions, type FrameContext } from '../../src/render/stage-frame';
import { BASS_PROFILE, NECK_PROFILE, PICK_PROFILE, type NeckProfile } from '../../src/render/neck-profile';
import { renderNeckFrame, type PhotoContext } from '../../src/render/neck-view';
import { makeTimeline, type NoteSpec } from '../helpers/make-timeline';
import { createRecordingContext, type Call } from '../helpers/recording-context';

const W = 1920;
const H = 1080;

const specs: NoteSpec[] = [1, 2, 3, 4, 5, 6, 7].map((s, i) => ({
  start: s,
  end: s + 0.5,
  string: 1 + (i % 6),
  fret: 2 + i,
}));
const timeline = makeTimeline(specs, 2, 6);

function frame(t: number, panels: PanelId[], view: ExportViewOptions = { lookahead: 4 }, w = W, h = H, photo: unknown = null): Call[] {
  const { ctx, calls } = createRecordingContext();
  renderStageFrame(ctx as unknown as FrameContext, timeline, 0, t, w, h, panels, { ...view, photo: photo as CanvasImageSource | null });
  return calls;
}

const dashed = (calls: Call[]) => calls.filter((c) => c.name === 'setLineDash' && (c.args[0] as number[]).length > 0);
const translates = (calls: Call[]) => calls.filter((c) => c.name === 'translate');

describe('frame layout', () => {
  it('shares the height between the panels, and adds a slim bar strip only when the tab strip is not shown', () => {
    const two = frameLayout(H, 2, false);
    expect(two.bar).toBeNull();
    expect(two.panels[0].top).toBe(0);
    expect(two.panels[1].top + two.panels[1].height).toBe(H);

    const withBar = frameLayout(H, 2, true);
    expect(withBar.bar).not.toBeNull();
    expect(withBar.bar!.top + withBar.bar!.height).toBe(H);
    expect(withBar.panels[1].top + withBar.panels[1].height).toBeLessThan(withBar.bar!.top);
  });

  it('gives a single panel the whole frame above its bar strip', () => {
    const one = frameLayout(H, 1, false);
    expect(one.panels).toEqual([{ top: 0, height: H }]);
  });
});

describe('frame panels', () => {
  it('draws any two panels, in the order chosen', () => {
    // highway + tab: one region below the first, no bar strip
    expect(translates(frame(2.2, ['highway', 'tab']))).toHaveLength(1);
    // highway + real guitar: the real guitar region, then the bar strip
    expect(translates(frame(2.2, ['highway', 'neck']))).toHaveLength(2);
    // tab + real guitar: no bar strip
    expect(translates(frame(2.2, ['tab', 'neck']))).toHaveLength(1);
    // real guitar alone: just the bar strip below it
    expect(translates(frame(2.2, ['neck']))).toHaveLength(1);
  });

  it('draws the photo into the real guitar panel when it is given', () => {
    const image = { width: 10, height: 10 };
    expect(frame(2.2, ['highway', 'neck'], { lookahead: 4 }, W, H, image).some((c) => c.name === 'drawImage')).toBe(true);
    expect(frame(2.2, ['highway', 'tab'], { lookahead: 4 }, W, H, image).some((c) => c.name === 'drawImage')).toBe(false);
  });

  it('draws the fretboard when it is chosen, and not when it is not', () => {
    expect(dashed(frame(2.2, ['highway', 'fretboard'])).length).toBeGreaterThan(0);
    expect(dashed(frame(2.2, ['highway', 'tab']))).toHaveLength(0);
  });

  it('puts the same fretboard dots in the frame as the live fretboard draws', () => {
    const t = 2.2;
    const region = frameLayout(H, 2, true).panels[1];

    const live = createRecordingContext();
    renderFretboard(live.ctx, timeline, 0, t, W, region.height, { lookahead: 4 });
    const liveArcs = live.calls.filter((c) => c.name === 'arc');
    expect(liveArcs.length).toBeGreaterThan(0);

    const neck = computeNeck(W, region.height, 6, maxFretUsed(timeline.notesForTrack(0)));
    const frameArcs = frame(t, ['highway', 'fretboard']).filter((c) => c.name === 'arc' && (c.args[2] as number) <= neck.dotRadius * 4);
    for (const arc of liveArcs) expect(frameArcs).toContainEqual(arc);
  });

  it('uses the look-ahead it is given: 1 and 6 draw different numbers of upcoming markers', () => {
    const outlined = (la: number) => {
      const neck = computeNeck(W, frameLayout(H, 2, true).panels[1].height, 6, 8);
      return frame(2.2, ['highway', 'fretboard'], { lookahead: la }).filter(
        (c) => c.name === 'arc' && Math.abs((c.args[2] as number) - neck.dotRadius * 0.7) < 1e-9,
      ).length;
    };
    expect(outlined(1)).toBe(1);
    expect(outlined(6)).toBeGreaterThan(outlined(1));
  });

  it('lays out a vertical frame with the second panel in the lower part', () => {
    const regions = translates(frame(2.2, ['highway', 'fretboard'], { lookahead: 4 }, 1080, 1920));
    expect(regions).toHaveLength(2);
    expect(regions[0].args[1] as number).toBeGreaterThan(1920 * 0.4);
    expect(regions[1].args[1] as number).toBeGreaterThan(regions[0].args[1] as number);
  });

  it('draws the same frame for the same time, wherever it is rendered', () => {
    expect(frame(2.2, ['tab', 'neck'])).toEqual(frame(2.2, ['tab', 'neck']));
  });
});

describe('export start message', () => {
  it('sends the chosen panels and the look-ahead to the worker', () => {
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
        timeline,
        trackIndex: 0,
        preset: presetById('landscape'),
        audio: { left: new Float32Array(48000), right: new Float32Array(48000), sampleRate: 48000 },
        panels: ['highway', 'fretboard'],
        view: { lookahead: 6 },
        onProgress: () => {},
      }).result.catch(() => {});
    } finally {
      (globalThis as { Worker?: unknown }).Worker = original;
    }
    const start = posted[0] as StartMessage;
    expect(start.type).toBe('start');
    expect(start.panels).toEqual(['highway', 'fretboard']);
    expect(start.view).toEqual({ lookahead: 6 });
    expect(start.preset.id).toBe('landscape');
  });

  it('sends the alignment and the lengthened output to the worker, and stretches the audio to match', () => {
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
        timeline,
        trackIndex: 0,
        preset: presetById('landscape'),
        audio: { left: new Float32Array(48000), right: new Float32Array(48000), sampleRate: 48000 },
        panels: ['highway', 'tab'],
        view: { lookahead: 6 },
        alignment: AlignmentMap.of(1, [{ at: 4, length: 3 }]),
        onProgress: () => {},
      }).result.catch(() => {});
    } finally {
      (globalThis as { Worker?: unknown }).Worker = original;
    }
    const start = posted[0] as StartMessage;
    expect(start.alignment).toEqual({ base: 1, holds: [{ at: 4, length: 3 }] });
    expect(start.outputSeconds).toBeCloseTo(timeline.durationSeconds + 3, 9);
    expect(start.audio.left).toHaveLength(Math.ceil((timeline.durationSeconds + 3) * 48000));
  });

  it('sends the anchors with their bars, and the span of the recording as the output length', () => {
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
    const spans = timeline.bars.map((b) => ({ start: b.startSeconds, end: b.endSeconds }));
    const anchors = spans.map((b, k) => b.start + 1 + k * 0.1);
    const map = AlignmentMap.fromAnchors(spans, anchors, timeline.durationSeconds + 1 + spans.length * 0.1)!;
    try {
      void startExport({
        timeline,
        trackIndex: 0,
        preset: presetById('landscape'),
        audio: { left: new Float32Array(48000), right: new Float32Array(48000), sampleRate: 48000 },
        panels: ['highway', 'tab'],
        view: { lookahead: 6 },
        alignment: map,
        onProgress: () => {},
      }).result.catch(() => {});
    } finally {
      (globalThis as { Worker?: unknown }).Worker = original;
    }
    const start = posted[0] as StartMessage;
    expect(start.alignment?.anchors).toHaveLength(spans.length);
    expect(start.alignment?.bars).toHaveLength(spans.length);
    expect(start.outputSeconds).toBeCloseTo(map.outputLength(timeline.durationSeconds), 9);
    const rebuilt = AlignmentMap.normalize(start.alignment);
    expect(rebuilt?.hasAnchors).toBe(true);
    expect(rebuilt?.toRec(timeline.bars[2].startSeconds, 'start')).toBeCloseTo(anchors[2], 9);
  });

  it('sends no alignment and the tab length when there is none', () => {
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
        timeline,
        trackIndex: 0,
        preset: presetById('landscape'),
        audio: { left: new Float32Array(48000), right: new Float32Array(48000), sampleRate: 48000 },
        panels: ['highway', 'tab'],
        view: { lookahead: 6 },
        onProgress: () => {},
      }).result.catch(() => {});
    } finally {
      (globalThis as { Worker?: unknown }).Worker = original;
    }
    const start = posted[0] as StartMessage;
    expect(start.alignment).toBeUndefined();
    expect(start.outputSeconds).toBe(timeline.durationSeconds);
  });

  it('covers AE6: carries the choice of technique cues to the worker with the other view options', () => {
    for (const neckCues of [true, false]) {
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
          timeline,
          trackIndex: 0,
          preset: presetById('landscape'),
          audio: { left: new Float32Array(48000), right: new Float32Array(48000), sampleRate: 48000 },
          panels: ['highway', 'neck'],
          view: { lookahead: 6, neckCues },
          onProgress: () => {},
        }).result.catch(() => {});
      } finally {
        (globalThis as { Worker?: unknown }).Worker = original;
      }
      expect((posted[0] as StartMessage).view.neckCues).toBe(neckCues);
    }
  });
});

describe('the pick view in a frame', () => {
  const image = { width: 10, height: 10 };
  const pickFrame = (t: number, panels: PanelId[], view: ExportViewOptions, pickPhoto: { photo: unknown; profile: NeckProfile } | null) => {
    const { ctx, calls } = createRecordingContext();
    renderStageFrame(ctx as unknown as FrameContext, timeline, 0, t, W, H, panels, { ...view, pickPhoto: pickPhoto as never });
    return calls;
  };

  it('covers AE16: draws the pick view with its own photo, like any other panel', () => {
    expect(pickFrame(2.2, ['highway', 'pick'], { lookahead: 4 }, { photo: image, profile: PICK_PROFILE }).some((c) => c.name === 'drawImage')).toBe(true);
    // laid out like the Real guitar view: the same regions, the bar strip included
    const neckFrame = frame(2.2, ['highway', 'neck'], { lookahead: 4 }, W, H, image);
    expect(translates(pickFrame(2.2, ['highway', 'pick'], { lookahead: 4 }, { photo: image, profile: PICK_PROFILE }))).toHaveLength(translates(neckFrame).length);
  });

  it('covers AE6, AE10: draws each of the two guitar views against its own photo and profile', () => {
    const real = { width: 11, height: 11 };
    const pick = { width: 22, height: 22 };
    const { ctx, calls } = createRecordingContext();
    renderStageFrame(ctx as unknown as FrameContext, timeline, 0, 2.2, W, H, ['neck', 'pick'], {
      lookahead: 4,
      photo: real as unknown as CanvasImageSource,
      pickPhoto: { photo: pick as unknown as CanvasImageSource, profile: PICK_PROFILE },
    });
    const images = calls.filter((c) => c.name === 'drawImage');
    expect(images.map((c) => c.args[0])).toEqual([real, pick]);
    // the Real guitar view is drawn at its own photo size, the pick view at its own
    expect(images[0].args.slice(3)).toEqual([NECK_PROFILE.photoWidth, NECK_PROFILE.photoHeight]);
    expect(images[1].args.slice(3)).toEqual([PICK_PROFILE.photoWidth, PICK_PROFILE.photoHeight]);
  });

  it('covers AE7: draws the same calls through the page path and the export path for the same song, photo, profile and time', () => {
    const panelHeight = frameLayout(H / 2, 1, true).panels[0].height;
    const live = createRecordingContext();
    renderNeckFrame(live.ctx as unknown as PhotoContext, image as unknown as CanvasImageSource, timeline, 0, 2.2, W / 2, panelHeight, {
      zoom: true,
      lookahead: 4,
      techniqueCues: true,
      profile: PICK_PROFILE,
    });
    const exported = createRecordingContext();
    renderStageFrame(exported.ctx as unknown as FrameContext, timeline, 0, 2.2, W / 2, H / 2, ['pick'], {
      lookahead: 4,
      photo: null,
      pickPhoto: { photo: image as unknown as CanvasImageSource, profile: PICK_PROFILE },
    });
    // the export draws exactly the page's neck calls, as one run inside its panel region
    const run = JSON.stringify(live.calls).slice(1, -1);
    expect(live.calls.length).toBeGreaterThan(50);
    expect(JSON.stringify(exported.calls)).toContain(run);
  });

  it('shows the pick effects with technique cues on and none with them off', () => {
    const quads = (cues: boolean) => pickFrame(2.2, ['pick'], { lookahead: 4, neckCues: cues }, { photo: image, profile: PICK_PROFILE }).filter((c) => c.name === 'quadraticCurveTo').length;
    expect(quads(true)).toBeGreaterThan(quads(false));
  });
});

describe('a start message for the pick view', () => {
  it('posts the profile together with the photo, and hands the photo over to the worker', () => {
    const posted: { message: unknown; transfer: unknown[] }[] = [];
    class FakeWorker {
      onmessage: unknown = null;
      onerror: unknown = null;
      postMessage(message: unknown, transfer: unknown[] = []) {
        posted.push({ message, transfer });
      }
      terminate() {}
    }
    const original = (globalThis as { Worker?: unknown }).Worker;
    (globalThis as { Worker?: unknown }).Worker = FakeWorker;
    const photo = { width: 4, height: 4 } as unknown as ImageBitmap;
    const calibrated: NeckProfile = { ...PICK_PROFILE, nutX: PICK_PROFILE.nutX + 3 };
    try {
      void startExport({
        timeline,
        trackIndex: 0,
        preset: presetById('landscape'),
        audio: { left: new Float32Array(48000), right: new Float32Array(48000), sampleRate: 48000 },
        panels: ['highway', 'pick'],
        view: { lookahead: 6 },
        pickPhoto: { photo, profile: calibrated },
        onProgress: () => {},
      }).result.catch(() => {});
    } finally {
      (globalThis as { Worker?: unknown }).Worker = original;
    }
    const start = posted[0].message as StartMessage;
    expect(start.pickPhoto?.profile).toEqual(calibrated);
    expect(start.pickPhoto?.photo).toBe(photo);
    expect(posted[0].transfer).toContain(photo);
    expect(start.photo).toBeUndefined();
  });
});

describe('the Real guitar view on a bass', () => {
  const image = { tag: 'bass' } as unknown as CanvasImageSource;
  const bassTimeline = makeTimeline([{ start: 1, end: 2, string: 4, fret: 5 }, { start: 3, end: 4, string: 1, fret: 7 }], 2, 4, 4);
  const guitarTimeline = makeTimeline([{ start: 1, end: 2, string: 4, fret: 5 }], 2, 4, 6);

  function neckCalls(line: typeof bassTimeline): Call[] {
    const { ctx, calls } = createRecordingContext();
    renderStageFrame(ctx as unknown as FrameContext, line, 0, 1.2, W, H, ['neck'], { lookahead: 4, photo: image });
    return calls;
  }

  it('covers R1: draws a 4-string track on the bass photo, sized to the bass profile', () => {
    const drawn = neckCalls(bassTimeline).find((c) => c.name === 'drawImage');
    expect(drawn?.args[3]).toBe(BASS_PROFILE.photoWidth);
    expect(drawn?.args[4]).toBe(BASS_PROFILE.photoHeight);
  });

  it('covers R2: draws any other track on the guitar photo, sized to the guitar profile', () => {
    const drawn = neckCalls(guitarTimeline).find((c) => c.name === 'drawImage');
    expect(drawn?.args[3]).toBe(NECK_PROFILE.photoWidth);
    expect(drawn?.args[4]).toBe(NECK_PROFILE.photoHeight);
  });

  it('draws the same calls twice for the same time', () => {
    expect(neckCalls(bassTimeline)).toEqual(neckCalls(bassTimeline));
  });
});
