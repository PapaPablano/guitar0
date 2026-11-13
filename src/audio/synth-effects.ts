import type { PcmAudio } from '../export/audio';

/**
 * Light effects for the tab's synth: a gentle EQ, a small room, some makeup gain and a ceiling. Drive is not here:
 * alphaTab hands over one mixed stream, so any drive would also bite the drums, bass and keys. The guitars get their
 * drive from the SoundFont's own Crunch and Distortion sounds.
 */
export interface EffectsSettings {
  /** Gain after the room, set so the processed sound is as loud as the plain one on a normal mix (KTD8). */
  readonly makeupDb: number;
  /** Cuts rumble below this frequency. */
  readonly highPassHz: number;
  readonly lowShelf: { readonly hz: number; readonly db: number };
  readonly highShelf: { readonly hz: number; readonly db: number };
  /** Share of room sound added to the dry signal, 0..1. */
  readonly roomMix: number;
  readonly roomSeconds: number;
}

/**
 * `makeupDb` is 0 because the processed path already lands on the plain sound's loudness (an estimate; confirm by ear with
 * the effects switch and level readout in `dev/soundfont-compare.html`):
 * - Room: 0.84 dry plus 0.16 room. Web Audio normalises the impulse, so the room passes about -11 dB of power whatever its
 *   decay; the two add to about -1.5 dB.
 * - EQ: the two shelves add about +0.8 to +1.7 dB on a guitar-heavy, pink or bass-heavy band spectrum.
 * - Together: -0.7 to +0.2 dB, within a just-noticeable difference of plain. The old -3 dB only offset the old ceiling's
 *   +3 dB lift on quiet signals, which the knee below removes.
 */
export const DEFAULT_EFFECTS: EffectsSettings = {
  makeupDb: 0,
  highPassHz: 35,
  lowShelf: { hz: 120, db: 1.5 },
  highShelf: { hz: 6000, db: 2 },
  roomMix: 0.16,
  roomSeconds: 1.2,
};

/** A small deterministic random source, so the room sounds the same live and in the export. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The room's impulse response: decaying noise, one array per channel, the same for the same inputs. */
export function roomImpulse(sampleRate: number, seconds: number, seed = 7): [Float32Array, Float32Array] {
  const length = Math.max(1, Math.floor(sampleRate * seconds));
  const channels: [Float32Array, Float32Array] = [new Float32Array(length), new Float32Array(length)];
  channels.forEach((data, c) => {
    const random = seeded(seed + c * 101);
    for (let i = 0; i < length; i++) data[i] = (random() * 2 - 1) * Math.pow(1 - i / length, 3);
  });
  return channels;
}

/** Below this level (about -3 dBFS) the ceiling passes the signal through unchanged (KTD8). */
export const CEILING_KNEE = 0.7;
/** The level the ceiling bends towards above the knee and never reaches. */
const CEILING_LIMIT = 0.98;

/**
 * A clipping guard, not a sound (R12): output equals input up to the knee, then bends smoothly towards a limit under full
 * scale. The slope is 1 at the knee, so there is no kink. Inputs past full scale get the curve's end value.
 */
export function softClipCurve(points = 2048): Float32Array {
  const curve = new Float32Array(points);
  const room = CEILING_LIMIT - CEILING_KNEE;
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 2 - 1;
    const size = Math.abs(x);
    curve[i] = size <= CEILING_KNEE ? x : Math.sign(x) * (CEILING_KNEE + room * Math.tanh((size - CEILING_KNEE) / room));
  }
  return curve;
}

/** How long switching the effects on or off fades between the two paths: long enough not to click, short enough to feel instant. */
export const CROSSFADE_SECONDS = 0.01;

export interface EffectsChain {
  input: AudioNode;
  output: AudioNode;
  /** Crossfades to the processed sound (true) or the plain sound (false), without rebuilding anything (KTD7). */
  setEnabled(on: boolean): void;
}

/**
 * Builds the effects between `input` and `output` on any audio context. The live page and the export both call this, so they
 * cannot drift apart. The input feeds a plain path and a processed path that meet at the output; `enabled` picks which one
 * is heard at the start, and `setEnabled` fades between them.
 */
export function buildEffects(ctx: BaseAudioContext, enabled = true, settings: EffectsSettings = DEFAULT_EFFECTS): EffectsChain {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const plain = ctx.createGain();
  plain.gain.value = enabled ? 0 : 1;
  const processed = ctx.createGain();
  processed.gain.value = enabled ? 1 : 0;

  const highPass = ctx.createBiquadFilter();
  highPass.type = 'highpass';
  highPass.frequency.value = settings.highPassHz;
  const lowShelf = ctx.createBiquadFilter();
  lowShelf.type = 'lowshelf';
  lowShelf.frequency.value = settings.lowShelf.hz;
  lowShelf.gain.value = settings.lowShelf.db;
  const highShelf = ctx.createBiquadFilter();
  highShelf.type = 'highshelf';
  highShelf.frequency.value = settings.highShelf.hz;
  highShelf.gain.value = settings.highShelf.db;

  const dry = ctx.createGain();
  dry.gain.value = 1 - settings.roomMix;
  const room = ctx.createConvolver();
  const [left, right] = roomImpulse(ctx.sampleRate, settings.roomSeconds);
  const impulse = ctx.createBuffer(2, left.length, ctx.sampleRate);
  impulse.copyToChannel(left as Float32Array<ArrayBuffer>, 0);
  impulse.copyToChannel(right as Float32Array<ArrayBuffer>, 1);
  room.buffer = impulse;
  const wet = ctx.createGain();
  wet.gain.value = settings.roomMix;

  const makeup = ctx.createGain();
  makeup.gain.value = Math.pow(10, settings.makeupDb / 20);
  const ceiling = ctx.createWaveShaper();
  ceiling.curve = softClipCurve() as Float32Array<ArrayBuffer>;
  ceiling.oversample = '2x';

  input.connect(highPass);
  highPass.connect(lowShelf);
  lowShelf.connect(highShelf);
  highShelf.connect(dry);
  highShelf.connect(room);
  room.connect(wet);
  dry.connect(makeup);
  wet.connect(makeup);
  makeup.connect(ceiling);
  ceiling.connect(processed);
  processed.connect(output);
  input.connect(plain);
  plain.connect(output);

  const fadeTo = (gain: AudioParam, value: number) => {
    const now = ctx.currentTime;
    // Hold where the gain is now, so a flip in the middle of a fade carries on from there instead of jumping.
    const from = gain.value;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(from, now);
    gain.linearRampToValueAtTime(value, now + CROSSFADE_SECONDS);
  };
  return {
    input,
    output,
    setEnabled(on) {
      fadeTo(processed.gain, on ? 1 : 0);
      fadeTo(plain.gain, on ? 0 : 1);
    },
  };
}

/** The slice of alphaTab's player this reaches into. It is private there, so every step is checked. */
interface OutputHolder {
  _player?: { _instance?: { _output?: { context?: AudioContext | null } } };
}

/** The effects as installed on the live player. */
export interface LiveEffects {
  /** Switches the effects on or off during playback (R11). */
  setEnabled(on: boolean): void;
  /** Takes the effects out again. */
  remove(): void;
  /** What the speakers are fed, after the switch, for a level meter; null when the effects could not be installed. */
  output: AudioNode | null;
}

const NO_LIVE_EFFECTS: LiveEffects = { setEnabled: () => {}, remove: () => {}, output: null };

/**
 * Puts the effects between alphaTab's audio and the speakers. alphaTab connects its output node to `context.destination`, so
 * that property is pointed at the effects and the effects are connected to the real destination. `enabled` is the switch's
 * starting position. When alphaTab's internals are not as expected, nothing is changed, playback stays plain and the switch
 * does nothing.
 */
export function installLiveEffects(api: object, enabled = true): LiveEffects {
  try {
    const context = (api as OutputHolder)._player?._instance?._output?.context;
    if (!context) {
      console.warn('Live effects are off: alphaTab no longer exposes its audio output where they expect it.');
      return NO_LIVE_EFFECTS;
    }
    const realDestination = context.destination;
    const chain = buildEffects(context, enabled);
    chain.output.connect(realDestination);
    Object.defineProperty(context, 'destination', { configurable: true, get: () => chain.input });
    return {
      setEnabled: (on) => {
        try {
          chain.setEnabled(on);
        } catch {
          // The context may already be closed.
        }
      },
      remove: () => {
        try {
          Object.defineProperty(context, 'destination', { configurable: true, get: () => realDestination });
          chain.output.disconnect();
        } catch {
          // The context may already be closed.
        }
      },
      output: chain.output,
    };
  } catch {
    return NO_LIVE_EFFECTS;
  }
}

/** Runs rendered audio through the same effects, offline, keeping its length. Returns it unchanged where offline audio is missing. */
export async function renderWithEffects(pcm: PcmAudio, settings: EffectsSettings = DEFAULT_EFFECTS): Promise<PcmAudio> {
  if (typeof OfflineAudioContext === 'undefined' || pcm.left.length === 0) return pcm;
  try {
    const ctx = new OfflineAudioContext(2, pcm.left.length, pcm.sampleRate);
    const source = ctx.createBufferSource();
    const buffer = ctx.createBuffer(2, pcm.left.length, pcm.sampleRate);
    buffer.copyToChannel(pcm.left as Float32Array<ArrayBuffer>, 0);
    buffer.copyToChannel(pcm.right as Float32Array<ArrayBuffer>, 1);
    source.buffer = buffer;
    const chain = buildEffects(ctx, true, settings);
    source.connect(chain.input);
    chain.output.connect(ctx.destination);
    source.start(0);
    const rendered = await ctx.startRendering();
    return { left: rendered.getChannelData(0).slice(), right: rendered.getChannelData(1).slice(), sampleRate: pcm.sampleRate };
  } catch {
    // A song too long for the browser to render with effects still exports, with the plain sound.
    return pcm;
  }
}
