/**
 * How long after a clock reports a position that position is heard. The browser reports it on the audio context that
 * plays the sound, and it is read each time rather than kept: it is 0 on a context that has not started yet and it
 * changes when the output device does.
 */

interface LatencySource {
  readonly baseLatency?: number;
  readonly outputLatency?: number;
}

/** The latency a context reports, in seconds. */
export function contextLatency(context: LatencySource): number {
  const total = (context.baseLatency || 0) + (context.outputLatency || 0);
  return Number.isFinite(total) && total > 0 ? total : 0;
}

let playing: AudioContext | null = null;
let probed: number | undefined;

/** Says which context the page's sound plays through, so the tab's synth reads its latency instead of a stand-in's. */
export function useLatencyContext(context: AudioContext): void {
  playing = context;
}

/** Output latency in seconds for a clock with no context of its own: the page's playing context if it has started, else one probe. */
export function readOutputLatency(): number {
  if (playing && playing.state === 'running') {
    const live = contextLatency(playing);
    if (live > 0) return live;
  }
  if (probed !== undefined) return probed;
  try {
    const probe = new AudioContext();
    probed = contextLatency(probe);
    void probe.close();
    return probed;
  } catch {
    return 0;
  }
}
