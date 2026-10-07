import { describe, expect, it } from 'vitest';
import { audioFilename, encodeWav, planAudioExport, slicePcm } from '../../src/export/audio-file';

function ascii(view: DataView, at: number, n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += String.fromCharCode(view.getUint8(at + i));
  return s;
}

describe('encodeWav', () => {
  const pcm = { left: Float32Array.from([0, 0.5, -1, 2]), right: Float32Array.from([1, -0.5, 0, -2]), sampleRate: 48000 };
  const bytes = encodeWav(pcm);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  it('writes a RIFF/WAVE 16-bit stereo header matching the render', () => {
    expect(ascii(view, 0, 4)).toBe('RIFF');
    expect(ascii(view, 8, 4)).toBe('WAVE');
    expect(ascii(view, 12, 4)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(2); // channels
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint32(28, true)).toBe(48000 * 4); // byte rate
    expect(view.getUint16(32, true)).toBe(4); // block align
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(view, 36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(4 * 4); // 4 frames
    expect(view.getUint32(4, true)).toBe(bytes.length - 8);
    expect(bytes.length).toBe(44 + 16);
  });

  it('interleaves L R and clamps samples', () => {
    const s = (i: number) => view.getInt16(44 + i * 2, true);
    expect([s(0), s(1)]).toEqual([0, 32767]);
    expect(s(2)).toBeCloseTo(16384, -1);
    expect(s(3)).toBeCloseTo(-16384, -1);
    expect(s(4)).toBe(-32768);
    expect(s(6)).toBe(32767); // 2 clamps to full scale
    expect(s(7)).toBe(-32768);
  });
});

describe('slicePcm', () => {
  it('cuts a window and pads silence past the end', () => {
    const data = Float32Array.from([1, 2, 3, 4]);
    const out = slicePcm({ left: data, right: data.slice(), sampleRate: 4 }, 0.5, 1.5);
    expect(Array.from(out.left)).toEqual([3, 4, 0, 0, 0, 0]);
    expect(out.sampleRate).toBe(4);
  });
});

describe('planAudioExport', () => {
  it('plans the whole song when there is no range', () => {
    expect(planAudioExport(120, null)).toEqual({ ok: true, startSeconds: 0, durationSeconds: 120 });
  });

  it('plans just the range', () => {
    expect(planAudioExport(120, { startSeconds: 10, endSeconds: 25 })).toEqual({ ok: true, startSeconds: 10, durationSeconds: 15 });
  });

  it('a 9-minute song with a 30-second range is under the cap', () => {
    expect(planAudioExport(540, { startSeconds: 100, endSeconds: 130 })).toEqual({ ok: true, startSeconds: 100, durationSeconds: 30 });
  });

  it('has no length limit: a whole long song and a long range are both planned', () => {
    expect(planAudioExport(3 * 3600, null)).toEqual({ ok: true, startSeconds: 0, durationSeconds: 3 * 3600 });
    expect(planAudioExport(7200, { startSeconds: 0, endSeconds: 3600 })).toEqual({ ok: true, startSeconds: 0, durationSeconds: 3600 });
  });

  it('refuses an empty range and a range outside the song', () => {
    for (const range of [
      { startSeconds: 10, endSeconds: 10 },
      { startSeconds: 20, endSeconds: 10 },
      { startSeconds: 130, endSeconds: 140 },
      { startSeconds: Number.NaN, endSeconds: 5 },
    ]) {
      const plan = planAudioExport(120, range);
      expect(plan.ok).toBe(false);
      if (!plan.ok) expect(plan.reason.length).toBeGreaterThan(0);
    }
  });

  it('clips a range that runs past the end of the song', () => {
    expect(planAudioExport(120, { startSeconds: 110, endSeconds: 200 })).toEqual({ ok: true, startSeconds: 110, durationSeconds: 10 });
  });
});

describe('audioFilename', () => {
  it('uses a .wav name and keeps the video one separate', () => {
    expect(audioFilename('My Song!')).toBe('MySong-audio.wav'.replace('MySong', 'My-Song'));
    expect(audioFilename('  ')).toBe('tab-audio.wav');
    expect(audioFilename('A', true)).toBe('A-loop-audio.wav');
  });
});
