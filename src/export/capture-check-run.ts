import { buildTestSignal, playTestSignal } from '../audio/capture-test-tone';
import { analyseCapture, type CheckReport } from './capture-check';
import type { CheckRun, HeardSound } from './capture-check-flow';
import { containerCandidates } from './record-capture';

/** The audio-only container that stands in for a video container when measuring what the encoder does to the sound. */
function audioMimeFor(videoMime: string): string {
  return videoMime.startsWith('video/mp4') ? 'audio/mp4;codecs=mp4a.40.2' : 'audio/webm;codecs=opus';
}

const BITRATES = [192_000, 320_000];
/** Time to let the recorders finish after the sound ends. */
const TAIL_MS = 400;
/** How long past the sound's own length to wait for it to finish before calling the check failed. */
const PLAY_GRACE_MS = 5000;

/** How much damage a report shows: the sum of its effects' sizes, with a missing sound counting as the worst. */
function lossOf(report: CheckReport): number {
  if (report.verdict === 'nothing') return 1000;
  return report.effects.reduce((sum, effect) => sum + Math.abs(effect.measured), 0);
}

interface Candidate {
  videoMime: string;
  audioBitsPerSecond: number;
  recorder: MediaRecorder;
  chunks: Blob[];
}

function mergeChunks(chunks: Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/**
 * Plays the test sound into the page's output while the shared stream is captured two ways: raw samples, to see what the
 * browser did to the sound, and short recorders in each container, to see what the encoder does on top. Needs a browser,
 * so it is checked by hand; the comparison it feeds is covered by tests.
 */
export async function runCaptureCheck(stream: MediaStream, isAborted: () => boolean): Promise<CheckRun> {
  const context = new AudioContext();
  const track = stream.getAudioTracks()[0];
  const cleanup: Array<() => void> = [];
  try {
    // A context made outside a click can start suspended, and a suspended one never plays the sound.
    await context.resume().catch(() => undefined);
    const signal = buildTestSignal(context.sampleRate);
    const captureStream = new MediaStream([track]);

    // Raw samples of the captured track. ScriptProcessor is deprecated but works in every target webview and needs no worklet file;
    // its output is left silent so the captured sound is never played back into the share.
    const raw: Float32Array[] = [];
    const source = context.createMediaStreamSource(captureStream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (e) => void raw.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    source.connect(processor);
    processor.connect(context.destination);
    cleanup.push(() => {
      processor.disconnect();
      source.disconnect();
    });

    // Short recorders, one per container and bitrate. A recorder the platform refuses means the encoder is not measured.
    let encoderSkipped = false;
    const candidates: Candidate[] = [];
    for (const videoMime of containerCandidates((type) => MediaRecorder.isTypeSupported(type))) {
      const audioMime = audioMimeFor(videoMime);
      if (!MediaRecorder.isTypeSupported(audioMime)) continue;
      for (const audioBitsPerSecond of BITRATES) {
        try {
          const recorder = new MediaRecorder(captureStream, { mimeType: audioMime, audioBitsPerSecond });
          const chunks: Blob[] = [];
          recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
          };
          recorder.start();
          candidates.push({ videoMime, audioBitsPerSecond, recorder, chunks });
        } catch {
          encoderSkipped = true;
        }
      }
    }
    if (candidates.length === 0) encoderSkipped = true;

    const finished = await Promise.race<boolean | 'timeout'>([
      playTestSignal(context, signal).then(() => new Promise<void>((r) => setTimeout(r, TAIL_MS))).then(() => true),
      new Promise<'timeout'>((resolve) => {
        const timer = setTimeout(() => resolve('timeout'), (signal.samples.length / signal.sampleRate) * 1000 + PLAY_GRACE_MS);
        cleanup.push(() => clearTimeout(timer));
      }),
      new Promise<boolean>((resolve) => {
        const poll = setInterval(() => {
          if (isAborted()) {
            clearInterval(poll);
            resolve(false);
          }
        }, 100);
        cleanup.push(() => clearInterval(poll));
      }),
    ]);

    const stopped = candidates.map(
      (c) =>
        new Promise<void>((resolve) => {
          if (c.recorder.state === 'inactive') return resolve();
          c.recorder.onstop = () => resolve();
          c.recorder.stop();
        }),
    );
    await Promise.all(stopped);
    if (finished === 'timeout') throw new Error('The test sound did not play, so the recording sound could not be checked.');

    const captured = mergeChunks(raw);
    if (!finished) {
      return { report: { verdict: 'clean', effects: [], latencySeconds: 0, aligned: false }, chosen: {}, encoderSkipped: true, heard: null };
    }
    const report = analyseCapture(signal, captured, context.sampleRate);

    let chosen: CheckRun['chosen'] = {};
    if (report.verdict !== 'nothing' && candidates.length > 0) {
      let best: { score: number; candidate: Candidate } | null = null;
      for (const candidate of candidates) {
        try {
          const decoded = await context.decodeAudioData(await new Blob(candidate.chunks).arrayBuffer());
          const score = lossOf(analyseCapture(signal, decoded.getChannelData(0), decoded.sampleRate));
          // On a tie the earlier candidate wins: mp4 before webm, the lower bitrate before the higher.
          if (best === null || score < best.score - 0.5) best = { score, candidate };
        } catch {
          // a container the page cannot decode back cannot be measured; it is left out of the comparison
        }
      }
      if (best) chosen = { mime: best.candidate.videoMime, audioBitsPerSecond: best.candidate.audioBitsPerSecond };
      else encoderSkipped = true;
    }

    return { report, chosen, encoderSkipped, heard: captured.length > 0 ? { samples: captured, sampleRate: context.sampleRate } : null };
  } finally {
    cleanup.forEach((fn) => fn());
    void context.close().catch(() => undefined);
  }
}

/** Plays back the captured test sound so the player can hear what came through. */
export async function playHeard(heard: HeardSound): Promise<void> {
  const context = new AudioContext();
  try {
    await playTestSignal(context, heard);
  } finally {
    void context.close().catch(() => undefined);
  }
}
