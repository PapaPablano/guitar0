import { describe, expect, it } from 'vitest';
import { concatPcm, deinterleave, fitPcm } from '../../src/export/audio';
import { checkExportSupport, INSECURE_MESSAGE, UNSUPPORTED_MESSAGE, videoConfigFor, type ExportEnvironment } from '../../src/export/capability';
import { estimateMegabytes, frameCount, frameTime, MAX_EXPORT_SECONDS, PRESETS, presetById } from '../../src/export/presets';
import { hydrateTimeline, serializeTimeline } from '../../src/model/serialize';
import { buildTimeline, loadAlphaTex } from '../../src/model/alphatab-adapter';
import { HIGHWAY_SHARE, renderComposite, type CompositeContext } from '../../src/render/composite';
import { renderHighway } from '../../src/render/highway';
import { REPEAT_AND_TEMPO } from '../fixtures/fixtures';
import { makeTimeline } from '../helpers/make-timeline';
import { createRecordingContext } from '../helpers/recording-context';

const supports = { isConfigSupported: async () => ({ supported: true }) };
const refuses = { isConfigSupported: async () => ({ supported: false }) };
const everything: ExportEnvironment = { VideoEncoder: supports, AudioEncoder: supports, OffscreenCanvas: class {} };

describe('presets and frame timing', () => {
  it('derives frame times from the frame number', () => {
    expect(frameTime(0, 60)).toBe(0);
    expect(frameTime(90, 60)).toBe(1.5);
    expect(frameTime(45, 30)).toBe(1.5);
  });

  it('counts enough frames to cover the song', () => {
    expect(frameCount(10, 60)).toBe(600);
    expect(frameCount(10.001, 60)).toBe(601);
    expect(frameCount(0, 60)).toBe(1);
  });

  it('offers a 1080p60 landscape preset and a vertical preset', () => {
    expect(presetById('landscape')).toMatchObject({ width: 1920, height: 1080, fps: 60 });
    const vertical = presetById('vertical');
    expect(vertical.height).toBeGreaterThan(vertical.width);
    expect(PRESETS).toHaveLength(2);
  });

  it('estimates the file size from the bitrates', () => {
    const landscape = presetById('landscape');
    expect(estimateMegabytes(landscape, 100)).toBeCloseTo(((landscape.videoBitrate + 160_000) * 100) / 8 / 1e6, 6);
  });
});

describe('checkExportSupport', () => {
  it('accepts a browser that supports the exact configs', async () => {
    expect(await checkExportSupport(everything, presetById('landscape'))).toEqual({ supported: true, reason: null });
  });

  it('refuses a browser without WebCodecs', async () => {
    const result = await checkExportSupport({}, presetById('landscape'));
    expect(result).toEqual({ supported: false, reason: UNSUPPORTED_MESSAGE });
  });

  it('explains when the page is not secure, since browsers disable WebCodecs there', async () => {
    const result = await checkExportSupport({ ...everything, isSecureContext: false }, presetById('landscape'));
    expect(result).toEqual({ supported: false, reason: INSECURE_MESSAGE });
  });

  it('refuses a browser where WebCodecs exists but the H.264 config is unsupported', async () => {
    const result = await checkExportSupport({ ...everything, VideoEncoder: refuses }, presetById('landscape'));
    expect(result.supported).toBe(false);
    expect(result.reason).toBe(UNSUPPORTED_MESSAGE);
  });

  it('refuses a browser where the AAC config is unsupported', async () => {
    const result = await checkExportSupport({ ...everything, AudioEncoder: refuses }, presetById('landscape'));
    expect(result.supported).toBe(false);
  });

  it('treats a throwing probe as unsupported', async () => {
    const throws = { isConfigSupported: async () => Promise.reject(new Error('boom')) };
    const result = await checkExportSupport({ ...everything, VideoEncoder: throws }, presetById('vertical'));
    expect(result.supported).toBe(false);
  });

  it('probes each preset at its own size and frame rate', async () => {
    const seen: VideoEncoderConfig[] = [];
    const spy = {
      isConfigSupported: async (config: VideoEncoderConfig) => {
        seen.push(config);
        return { supported: true };
      },
    };
    await checkExportSupport({ ...everything, VideoEncoder: spy }, presetById('vertical'));
    expect(seen[0]).toMatchObject({ width: 1080, height: 1920, framerate: 30 });
    expect(videoConfigFor(presetById('landscape'))).toMatchObject({ width: 1920, height: 1080, framerate: 60 });
  });
});

describe('length cap', () => {
  it('is a fixed, documented limit', () => {
    expect(MAX_EXPORT_SECONDS).toBe(360);
  });
});

describe('timeline serialization', () => {
  it('round-trips through plain data and structured clone', () => {
    const timeline = buildTimeline(loadAlphaTex(REPEAT_AND_TEMPO));
    const data = structuredClone(serializeTimeline(timeline, 0));
    const copy = hydrateTimeline(data);
    expect(copy.notesForTrack(0)).toEqual(timeline.notesForTrack(0));
    expect(copy.bars).toEqual(timeline.bars);
    expect(copy.durationSeconds).toBe(timeline.durationSeconds);
    expect(copy.notesForTrack(3)).toEqual([]);
  });
});

describe('composite frame', () => {
  const timeline = makeTimeline([
    { start: 1, end: 1.5, string: 2, fret: 5 },
    { start: 2, end: 3, string: 4, fret: 7 },
  ]);

  function composite(t: number, w = 1920, h = 1080) {
    const { ctx, calls } = createRecordingContext();
    // the recording context records any method call, including translate, rect and clip
    renderComposite(ctx as unknown as CompositeContext, timeline, 0, t, w, h);
    return calls;
  }

  it('draws the same frame for the same frame number, wherever it is rendered', () => {
    const t = frameTime(75, 60);
    expect(composite(t)).toEqual(composite(t));
  });

  it('puts the same note heads on the highway part as the live highway draws', () => {
    const t = frameTime(90, 60);
    const highwayHeight = Math.round(1080 * HIGHWAY_SHARE);
    const live = createRecordingContext();
    renderHighway(live.ctx, timeline, 0, t, 1920, highwayHeight);
    const liveArcs = live.calls.filter((c) => c.name === 'arc');
    const frameArcs = composite(t).filter((c) => c.name === 'arc');
    expect(liveArcs.length).toBeGreaterThan(0);
    expect(frameArcs).toEqual(liveArcs);
  });

  it('lays out a vertical frame with the highway above the strip', () => {
    const calls = composite(1, 1080, 1920);
    const strip = calls.find((c) => c.name === 'translate');
    expect(strip?.args[1]).toBeGreaterThan(1920 * 0.5);
  });
});

describe('pcm helpers', () => {
  it('splits interleaved stereo into planar channels', () => {
    const { left, right } = deinterleave(new Float32Array([1, -1, 2, -2, 3, -3]));
    expect(Array.from(left)).toEqual([1, 2, 3]);
    expect(Array.from(right)).toEqual([-1, -2, -3]);
  });

  it('joins chunks in order', () => {
    const pcm = concatPcm(
      [
        { left: new Float32Array([1, 2]), right: new Float32Array([5, 6]) },
        { left: new Float32Array([3]), right: new Float32Array([7]) },
      ],
      48000,
    );
    expect(Array.from(pcm.left)).toEqual([1, 2, 3]);
    expect(Array.from(pcm.right)).toEqual([5, 6, 7]);
  });

  it('pads with silence or truncates to the length of the video', () => {
    const base = { left: new Float32Array(100).fill(1), right: new Float32Array(100).fill(1), sampleRate: 100 };
    const longer = fitPcm(base, 2);
    expect(longer.left).toHaveLength(200);
    expect(longer.left[150]).toBe(0);
    expect(fitPcm(base, 0.5).left).toHaveLength(50);
    expect(fitPcm(base, 1)).toBe(base);
  });
});
