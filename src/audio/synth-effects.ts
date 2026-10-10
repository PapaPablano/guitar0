import type { PcmAudio } from '../export/audio';

/**
 * Light effects for the tab's synth: a gentle EQ, a small room, some makeup gain and a ceiling. Drive is not here:
 * alphaTab hands over one mixed stream, so any drive would also bite the drums, bass and keys. The guitars get their
 * drive from the SoundFont's own Crunch and Distortion sounds.
 */
export interface EffectsSettings {
  /** Gain after the room. The EQ and the room add level, and the guitars are now brought up to the bass and drums, so a full mix needs trimming to stay clear of the ceiling. */
  readonly makeupDb: number;
  /** Cuts rumble below this frequency. */
  readonly highPassHz: number;
  readonly lowShelf: { readonly hz: number; readonly db: number };
  readonly highShelf: { readonly hz: number; readonly db: number };
  /** Share of room sound added to the dry signal, 0..1. */
  readonly roomMix: number;
  readonly roomSeconds: number;
}

export const DEFAULT_EFFECTS: EffectsSettings = {
  makeupDb: -3,
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

/** A smooth ceiling: the output never reaches full scale, however loud the input. */
export function softClipCurve(points = 2048): Float32Array {
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 1.2) / Math.tanh(1.2) * 0.98;
  }
  return curve;
}

export interface EffectsChain {
  input: AudioNode;
  output: AudioNode;
}

/**
 * Builds the effects between `input` and `output` on any audio context. The live page and the export both call this, so they
 * cannot drift apart. With `enabled` false it is a plain pass-through.
 */
export function buildEffects(ctx: BaseAudioContext, enabled = true, settings: EffectsSettings = DEFAULT_EFFECTS): EffectsChain {
  if (!enabled) {
    const through = ctx.createGain();
    return { input: through, output: through };
  }
  const input = ctx.createGain();

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
  return { input, output: ceiling };
}

/** The slice of alphaTab's player this reaches into. It is private there, so every step is checked. */
interface OutputHolder {
  _player?: { _instance?: { _output?: { context?: AudioContext | null } } };
}

/**
 * Puts the effects between alphaTab's audio and the speakers. alphaTab connects its output node to `context.destination`, so
 * that property is pointed at the effects and the effects are connected to the real destination. Returns a function that
 * takes them out again. When alphaTab's internals are not as expected, nothing is changed and playback stays plain.
 */
export function installLiveEffects(api: object, enabled = true): () => void {
  try {
    const context = (api as OutputHolder)._player?._instance?._output?.context;
    if (!context) {
      console.warn('Live effects are off: alphaTab no longer exposes its audio output where they expect it.');
      return () => {};
    }
    const realDestination = context.destination;
    const chain = buildEffects(context, enabled);
    chain.output.connect(realDestination);
    Object.defineProperty(context, 'destination', { configurable: true, get: () => chain.input });
    return () => {
      try {
        Object.defineProperty(context, 'destination', { configurable: true, get: () => realDestination });
        chain.output.disconnect();
      } catch {
        // The context may already be closed.
      }
    };
  } catch {
    return () => {};
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
