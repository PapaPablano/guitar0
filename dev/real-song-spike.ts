/**
 * Dev-only measurement of the whole-song pass on a real recording (not shipped, not a test: decoding and the tab render
 * need a browser). Serve the project with `npm run dev`, put a tab and a recording in `dev/local/`, and open
 * `/dev/real-song-spike.html?tab=NAME.gp&rec=NAME.wav`. The result is printed on the page and logged as `SPIKE_RESULT`.
 *
 * Accuracy cannot be read off a recording with no ground truth, so this reports what can be checked:
 *  - held-out error: for each firm bar (its own onsets stand out), hide its evidence from the pass, solve, and compare the
 *    solved position with the position its own onsets give. Firm bars are the only ones with a reference.
 *  - how the whole-song positions differ from the bar-by-bar ones, and how uncertain each bar is.
 *  - onset energy at the solved bar lines of the weak bars against the energy at random offsets.
 */
import { barFactsOf, barSpansOf } from '../src/alignment/analyze';
import { evidenceCurve, onsetPeaks, peakOf } from '../src/alignment/evidence';
import { chromaFrames, downsampleMono, FEATURE_RATE, onsetEnvelope } from '../src/alignment/features';
import { matchRecording, type MatchInput } from '../src/alignment/match';
import { createSynthSession } from '../src/audio/synth-bridge';
import { buildTimeline, loadScoreFromBytes } from '../src/model/alphatab-adapter';

const out = document.getElementById('out')!;
const say = (text: string) => {
  out.textContent = text;
};

const quantile = (values: number[], q: number): number => {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};

const summary = (errors: number[]) => ({
  count: errors.length,
  within20: errors.filter((e) => e <= 0.02).length / Math.max(1, errors.length),
  within40: errors.filter((e) => e <= 0.04).length / Math.max(1, errors.length),
  within100: errors.filter((e) => e <= 0.1).length / Math.max(1, errors.length),
  medianMs: Math.round(quantile(errors, 0.5) * 1000),
  p90Ms: Math.round(quantile(errors, 0.9) * 1000),
  worstMs: Math.round(Math.max(0, ...errors) * 1000),
});

async function decode(bytes: ArrayBuffer): Promise<Float32Array> {
  const context = new OfflineAudioContext(1, 1, FEATURE_RATE);
  const decoded = await context.decodeAudioData(bytes);
  const mono = new Float32Array(decoded.length);
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const channel = decoded.getChannelData(c);
    for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / decoded.numberOfChannels;
  }
  return mono;
}

async function run() {
  const params = new URLSearchParams(location.search);
  const tabName = params.get('tab');
  const recName = params.get('rec');
  if (!tabName || !recName) return say('Give ?tab=NAME&rec=NAME for files in dev/local/.');

  say('loading files');
  const [tabBytes, recBytes] = await Promise.all(
    [tabName, recName].map(async (name) => {
      const response = await fetch(`./local/${name}`);
      if (!response.ok) throw new Error(`could not read dev/local/${name}`);
      return response.arrayBuffer();
    }),
  );
  say('decoding the recording');
  const recording = await decode(recBytes);

  say('rendering the tab');
  const score = loadScoreFromBytes(new Uint8Array(tabBytes));
  const timeline = buildTimeline(score);
  const session = createSynthSession(score, timeline.durationSeconds, timeline.tempoMap, { soundFontUrl: '../soundfont/sonivox.sf3' });
  await session.ready;
  const pcm = await session.clock.exportAudio((fraction) => say(`rendering the tab ${Math.round(fraction * 100)}%`));
  const tab = downsampleMono(pcm, FEATURE_RATE);

  say('features');
  const bars = barSpansOf(timeline);
  const base: MatchInput = {
    recording: chromaFrames(recording, FEATURE_RATE),
    tab: chromaFrames(tab, FEATURE_RATE),
    recordingOnsets: onsetEnvelope(recording, FEATURE_RATE),
    tabOnsets: onsetEnvelope(tab, FEATURE_RATE),
    bars,
    barFacts: barFactsOf(timeline),
  };

  say('matching');
  const started = performance.now();
  const full = matchRecording(base);
  const elapsed = (performance.now() - started) / 1000;
  if (full.kind !== 'aligned') return say(`not aligned: ${full.reason}`);

  const startOf = (k: number) => bars[k].start;
  const solved = bars.map((b) => full.map.toRec(b.start, 'start') - b.start);
  const perBar = bars.map((b) => full.perBarMap.toRec(b.start, 'start') - b.start);

  // Each bar's own evidence, centred where the whole-song pass put it, searched within 0.15 s of it (the onset stage's old reach).
  // A bar is firm when its peak stands out (standard score of 4) and beats every peak more than 50 ms away by a clear margin,
  // so a beat-aliased peak does not count as a reference.
  const tabPeaks = onsetPeaks(base.tabOnsets);
  const recPeaks = onsetPeaks(base.recordingOnsets);
  const own = bars.map((b, k) => {
    const curve = evidenceCurve(tabPeaks, recPeaks, b, solved[k], b.end);
    if (!curve) return { offset: solved[k], z: 0, margin: 0 };
    let best = -1;
    for (let j = 0; j < curve.z.length; j++) {
      if (Math.abs(curve.offsets[j] - solved[k]) > 0.15) continue;
      if (best < 0 || curve.z[j] > curve.z[best]) best = j;
    }
    let rival = -Infinity;
    for (let j = 0; j < curve.z.length; j++) if (Math.abs(curve.offsets[j] - curve.offsets[best]) > 0.05) rival = Math.max(rival, curve.z[j]);
    return { offset: peakOf({ offsets: curve.offsets.slice(Math.max(0, best - 1), best + 2), z: curve.z.slice(Math.max(0, best - 1), best + 2) }).offset, z: curve.z[best], margin: curve.z[best] - rival };
  });
  const skipped = bars.map((_, k) => k + 1 < bars.length && full.map.toRec(bars[k + 1].start, 'start') - full.map.toRec(bars[k].start, 'start') < 0.1);
  const firm = bars.map((_, k) => k).filter((k) => !skipped[k] && own[k].z >= 4 && own[k].margin >= 1);

  // Held out in five folds.
  const heldErrors: number[] = [];
  const heldMeta: { bar: number; z: number; errorMs: number }[] = [];
  for (let fold = 0; fold < 5; fold++) {
    say(`held-out fold ${fold + 1} of 5`);
    const hidden = new Set(firm.filter((_, n) => n % 5 === fold));
    const result = matchRecording({ ...base, heldOut: hidden });
    if (result.kind !== 'aligned') continue;
    for (const k of hidden) {
      const predicted = result.map.toRec(startOf(k), 'start') - startOf(k);
      const error = Math.abs(predicted - own[k].offset);
      heldErrors.push(error);
      heldMeta.push({ bar: k, z: own[k].z, errorMs: Math.round(error * 1000) });
    }
  }

  const weak = bars.map((_, k) => k).filter((k) => !skipped[k] && !firm.includes(k));
  const solvedVsPerBar = firm.map((k) => Math.abs(solved[k] - perBar[k]));
  const firmVsOwn = firm.map((k) => Math.abs(solved[k] - own[k].offset));
  const energy = (k: number, offset: number): number => {
    const curve = evidenceCurve(tabPeaks, recPeaks, bars[k], offset, bars[k].end);
    if (!curve) return 0;
    let nearest = 0;
    for (let j = 1; j < curve.offsets.length; j++) if (Math.abs(curve.offsets[j] - offset) < Math.abs(curve.offsets[nearest] - offset)) nearest = j;
    return curve.z[nearest];
  };
  const weakEnergy = weak.map((k) => energy(k, solved[k]));
  const weakElsewhere = weak.map((k) => energy(k, solved[k] + 0.13));

  const result = {
    tab: tabName,
    recording: recName,
    bars: bars.length,
    seconds: { match: Math.round(elapsed * 10) / 10 },
    firmBars: firm.length,
    weakBars: weak.length,
    skippedBars: skipped.filter(Boolean).length,
    tier: { confidence: full.confidence, matchedFraction: full.matchedFraction, skippedStretches: full.skippedStretches },
    heldOut: summary(heldErrors),
    wholeSongVsOwnOnsetsOnFirmBars: summary(firmVsOwn),
    wholeSongVsPerBarOnFirmBars: summary(solvedVsPerBar),
    weakBarOnsetEnergy: {
      atSolved: weakEnergy.length ? weakEnergy.reduce((a, b) => a + b, 0) / weakEnergy.length : NaN,
      atOffset130ms: weakElsewhere.length ? weakElsewhere.reduce((a, b) => a + b, 0) / weakElsewhere.length : NaN,
    },
    uncertaintyMs: {
      median: Math.round(quantile(full.uncertainty.filter(Number.isFinite), 0.5) * 1000),
      p90: Math.round(quantile(full.uncertainty.filter(Number.isFinite), 0.9) * 1000),
    },
    worstHeldOut: heldMeta.sort((a, b) => b.errorMs - a.errorMs).slice(0, 8),
  };
  const text = JSON.stringify(result, null, 2);
  say(text);
  console.log(`SPIKE_RESULT ${JSON.stringify(result)}`);
}

run().catch((e: unknown) => {
  const message = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
  say(`failed: ${message}`);
  console.log(`SPIKE_FAILED ${message}`);
});
