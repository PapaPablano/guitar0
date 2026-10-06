import { describe, expect, it } from 'vitest';
import { AlignmentMap } from '../../src/audio/alignment-map';
import { UserAudioClock, type AudioLike } from '../../src/audio/user-audio';

/** A small deterministic random source, so a failure can be replayed. */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/**
 * A band that wanders: every bar a little long or short, one bar played much longer, one run of bars skipped.
 * Returns the tab's bars and the recording second at which each bar starts.
 */
function wanderingBand(barCount: number, seed: number) {
  const rand = rng(seed);
  const barSeconds = 2.4;
  const bars = Array.from({ length: barCount }, (_, i) => ({ start: i * barSeconds, end: (i + 1) * barSeconds }));
  const anchors: number[] = [];
  let at = 0.5;
  for (let i = 0; i < barCount; i++) {
    anchors.push(at);
    const skipped = i >= 20 && i < 22;
    at += skipped ? 0 : barSeconds * (0.94 + rand() * 0.12) + (i === 12 ? 6 : 0);
  }
  return { bars, anchors, endAnchor: at };
}

describe('moving around with a bar-by-bar alignment', () => {
  it('keeps the element, the tab time and the map in agreement through thousands of random moves', () => {
    const { bars, anchors, endAnchor } = wanderingBand(60, 3);
    const duration = bars[bars.length - 1].end;
    const map = AlignmentMap.fromAnchors(bars, anchors, endAnchor)!;
    let now = 0;
    const el = {
      currentTime: 0,
      playbackRate: 1,
      preservesPitch: false,
      paused: true,
      ended: false,
      duration: 400,
      async play() {
        this.paused = false;
      },
      pause() {
        this.paused = true;
      },
    } as AudioLike & { paused: boolean; ended: boolean };
    const clock = new UserAudioClock(el, duration, null, null, () => now);
    clock.setAlignment(map);
    const advance = (dt: number) => {
      now += dt;
      if (!el.paused) el.currentTime += dt * clock.rate;
    };
    const rand = rng(11);
    let loopEnd: number | null = null;
    for (let step = 0; step < 3000; step++) {
      const op = rand();
      if (op < 0.35) {
        const tab = rand() * duration * 0.98;
        clock.seek(tab);
        expect(el.currentTime, `step ${step}: seek to ${tab}`).toBeCloseTo(map.toRec(tab, 'start'), 6);
        // with a loop on, a seek past its end wraps to the loop's start on the next read, so only check the plain case
        if (loopEnd === null) expect(clock.time(), `step ${step}: time after seek`).toBeCloseTo(map.toTab(el.currentTime), 6);
      } else if (op < 0.55) {
        if (clock.playing) clock.pause();
        else clock.play();
      } else if (op < 0.78) {
        const before = clock.time();
        advance(rand() * 3);
        const after = clock.time();
        if (clock.playing && loopEnd === null) expect(after, `step ${step}: tab time went backwards`).toBeGreaterThanOrEqual(before - 1e-6);
        if (clock.playing && loopEnd !== null) expect(after, `step ${step}: ran past the loop`).toBeLessThanOrEqual(loopEnd + 1e-3);
      } else if (op < 0.88) {
        const first = Math.floor(rand() * (bars.length - 9));
        const last = first + 1 + Math.floor(rand() * 8);
        loopEnd = bars[last].end;
        clock.setLoop({ start: bars[first].start, end: loopEnd });
      } else if (op < 0.94) {
        loopEnd = null;
        clock.setLoop(null);
      } else {
        clock.setRate([0.5, 0.75, 1, 1.25][Math.floor(rand() * 4)]);
      }
    }
  });
});
