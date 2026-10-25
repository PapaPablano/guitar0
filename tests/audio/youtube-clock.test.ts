import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nearestRate, rateNotice, YoutubeClock } from '../../src/audio/youtube-clock';
import type { EmbeddedPlayer } from '../../src/app/youtube-player';

const now = () => Date.now() / 1000;

/** A player that moves with the (fake) wall clock while playing, and can be made to land away from where it was sent. */
class FakePlayer implements EmbeddedPlayer {
  position = 0;
  private startedAt = now();
  isPlaying = false;
  isBuffering = false;
  appliedRate = 1;
  muted = false;
  seekError = 0;
  seeks: number[] = [];
  offered = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  private settle() {
    if (this.isPlaying && !this.isBuffering) this.position += (now() - this.startedAt) * this.appliedRate;
    this.startedAt = now();
  }
  play() {
    this.settle();
    this.isPlaying = true;
  }
  pause() {
    this.settle();
    this.isPlaying = false;
  }
  seek(seconds: number) {
    this.settle();
    this.seeks.push(seconds);
    this.position = seconds + this.seekError;
  }
  time() {
    this.settle();
    return this.position;
  }
  duration() {
    return 300;
  }
  setRate(rate: number) {
    this.settle();
    this.appliedRate = rate;
  }
  rate() {
    return this.appliedRate;
  }
  availableRates() {
    return this.offered;
  }
  mute() {
    this.muted = true;
  }
  unmute() {
    this.muted = false;
  }
  playing() {
    return this.isPlaying && !this.isBuffering;
  }
  buffering() {
    return this.isBuffering;
  }
  /** The embed's buffering state: the position freezes while the video stays "playing" in intent. */
  buffer(on: boolean) {
    this.settle();
    this.isBuffering = on;
  }
  load() {}
  destroy() {}
}

describe('YoutubeClock', () => {
  let player: FakePlayer;
  let clock: YoutubeClock;
  const advance = (seconds: number) => vi.advanceTimersByTime(seconds * 1000);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    player = new FakePlayer();
    clock = new YoutubeClock(player, 200, now);
  });
  afterEach(() => {
    clock.dispose();
    vi.useRealTimers();
  });

  it('reads tab time as the video position minus the offset', () => {
    clock.setOffset(2);
    clock.seek(10);
    expect(player.position).toBe(12);
    expect(clock.time()).toBeCloseTo(10, 3);
  });

  it('holds tab time at zero while the video is before the tab starts, and never seeks below zero', () => {
    clock.setOffset(2);
    player.position = 1; // the player scrubbed to 1 s, which is tab time -1
    advance(1);
    expect(clock.time()).toBe(0);
    clock.seek(0);
    expect(player.seeks.every((s) => s >= 0)).toBe(true);
  });

  it('counts the silence before a video that starts after the tab, then starts the player', () => {
    clock.setOffset(-3);
    clock.play();
    expect(player.isPlaying).toBe(false);
    expect(clock.inLeadIn).toBe(true);
    advance(1);
    expect(clock.time()).toBeCloseTo(1, 1);
    advance(2.5);
    expect(clock.time()).toBeGreaterThan(3);
    expect(player.isPlaying).toBe(true);
    expect(clock.inLeadIn).toBe(false);
  });

  it('keeps playing across a seek while playing and stays paused across a seek while paused', () => {
    clock.seek(20);
    expect(player.isPlaying).toBe(false);
    clock.play();
    clock.seek(40);
    expect(player.isPlaying).toBe(true);
    clock.pause();
    clock.seek(60);
    expect(player.isPlaying).toBe(false);
    expect(clock.time()).toBe(60);
  });

  it('resumes from the paused tab time after a pause', () => {
    clock.seek(10);
    clock.play();
    advance(2);
    clock.pause();
    const held = clock.time();
    expect(held).toBeCloseTo(12, 0);
    advance(5);
    expect(clock.time()).toBe(held);
    clock.play();
    expect(player.position).toBeCloseTo(held, 1);
    expect(clock.playing).toBe(true);
  });

  it('parks muted and paused, then resumes at the same tab time', () => {
    clock.seek(30);
    clock.play();
    advance(2);
    const at = clock.time();
    clock.park();
    expect(player.muted).toBe(true);
    expect(player.isPlaying).toBe(false);
    expect(clock.parked).toBe(true);
    clock.resumeAt(at, true);
    expect(player.muted).toBe(false);
    expect(clock.time()).toBeCloseTo(at, 1);
    expect(player.isPlaying).toBe(true);
  });

  it('wraps a loop once when the video passes its end', () => {
    clock.setLoop({ start: 10, end: 12 });
    clock.seek(10);
    player.seeks.length = 0;
    clock.play();
    player.seeks.length = 0;
    advance(2.2);
    const toStart = player.seeks.filter((s) => Math.abs(s - 10) < 0.01);
    expect(toStart).toHaveLength(1);
    expect(clock.time()).toBeLessThan(11);
  });

  it('stops at the end of the tab', () => {
    clock.seek(199);
    clock.play();
    advance(3);
    expect(clock.time()).toBe(200);
    expect(clock.playing).toBe(false);
    expect(player.isPlaying).toBe(false);
  });

  it('plays at the nearest offered rate for a tempo it cannot match, and says why', () => {
    clock.setRate(0.85);
    expect(clock.rate).toBe(0.75);
    expect(rateNotice(0.85, clock.rate)).toMatch(/75%.*85%/);
    clock.setRate(0.75);
    expect(rateNotice(0.75, clock.rate)).toBeNull();
  });

  it('advances tab time at the applied rate, not the requested one', () => {
    clock.setRate(0.85);
    clock.seek(10);
    clock.play();
    advance(4);
    expect(clock.time()).toBeCloseTo(10 + 4 * 0.75, 1);
  });

  it('corrects a jump the player lands away from, a bounded number of times', () => {
    player.seekError = 1;
    clock.seek(20);
    clock.play();
    player.seeks.length = 0;
    advance(8);
    // two corrections at most, then it is left alone
    expect(player.seeks.length).toBeLessThanOrEqual(2);
  });

  it('follows the embed own scrubbing while paused', () => {
    clock.seek(10);
    advance(1); // past the settle window
    player.position = 55;
    expect(clock.time()).toBe(55);
  });

  it('follows a video the player started with its own controls', () => {
    clock.seek(10);
    advance(1);
    player.play();
    expect(clock.time()).toBeGreaterThanOrEqual(10);
    expect(clock.playing).toBe(true);
  });

  it('stops with the player when it pauses by itself during playback, and takes over again when it plays', () => {
    clock.seek(10);
    clock.play();
    advance(1);
    player.pause(); // the viewer paused it with the embed's own control
    advance(3);
    expect(clock.playing).toBe(false);
    const held = clock.time();
    advance(5);
    expect(clock.time()).toBe(held);
    expect(held).toBeLessThan(12);
    player.play();
    advance(1);
    clock.time(); // the page reads the clock every frame
    expect(clock.playing).toBe(true);
  });

  describe('buffering', () => {
    const drift = () => clock.time() - player.time();

    it('holds the views at the frozen video instead of running ahead of it', () => {
      clock.seek(10);
      clock.play();
      advance(2);
      player.buffer(true);
      for (let i = 0; i < 6; i++) {
        advance(0.25);
        expect(Math.abs(drift())).toBeLessThan(0.1);
      }
      expect(clock.playing).toBe(true);
    });

    it('stays in step after a short buffer, with no hold and no jump back', () => {
      clock.seek(10);
      clock.play();
      advance(2);
      player.buffer(true);
      advance(0.5);
      player.buffer(false);
      let last = clock.time();
      for (let i = 0; i < 12; i++) {
        advance(0.25);
        const t = clock.time();
        expect(t).toBeGreaterThanOrEqual(last);
        expect(Math.abs(drift())).toBeLessThan(0.1);
        last = t;
      }
    });

    it('does not run ahead and snap back on a buffer of a second or two', () => {
      clock.seek(10);
      clock.play();
      advance(2);
      player.buffer(true);
      let last = clock.time();
      for (let i = 0; i < 6; i++) {
        advance(0.25);
        const t = clock.time();
        expect(t).toBeGreaterThanOrEqual(last - 0.01);
        last = t;
      }
      player.buffer(false);
      for (let i = 0; i < 4; i++) {
        advance(0.25);
        const t = clock.time();
        expect(t).toBeGreaterThanOrEqual(last - 0.01);
        expect(Math.abs(drift())).toBeLessThan(0.1);
        last = t;
      }
    });

    it('keeps playing through a long buffer and resumes with the video', () => {
      clock.seek(10);
      clock.play();
      advance(2);
      player.buffer(true);
      advance(8);
      expect(clock.playing).toBe(true);
      expect(Math.abs(drift())).toBeLessThan(0.1);
      player.buffer(false);
      advance(1);
      expect(clock.playing).toBe(true);
      expect(Math.abs(drift())).toBeLessThan(0.1);
    });

    it('does not seek the video forward to catch up after a buffer right after a jump', () => {
      clock.seek(10);
      clock.play();
      clock.seek(60);
      player.buffer(true);
      advance(3);
      player.buffer(false);
      advance(2);
      expect(player.seeks.filter((s) => s > 61)).toEqual([]);
    });
  });

  it('keeps a set offset against the tab while paused and moves the video instead', () => {
    clock.seek(20);
    clock.setOffset(5);
    expect(clock.time()).toBe(20);
    expect(player.position).toBe(25);
  });
});

describe('nearestRate', () => {
  it('chooses the closest offered rate and the lower one on a tie', () => {
    expect(nearestRate(0.85, [0.75, 1])).toBe(0.75);
    expect(nearestRate(0.875, [0.75, 1])).toBe(0.75);
    expect(nearestRate(1.1, [1, 1.25])).toBe(1);
  });

  it('uses the standard rates when the player offers none', () => {
    expect(nearestRate(0.3, [])).toBe(0.25);
  });
});

describe('rateNotice', () => {
  it('is empty when the rate matches', () => {
    expect(rateNotice(1, 1)).toBeNull();
  });
});
