/**
 * Dev-only listening page for choosing the band SoundFont (not shipped, not a test: it has to be heard).
 * Serve with `npm run dev`, put the candidate fonts and a tab in `dev/local/`, then open
 * `/dev/soundfont-compare.html` (optionally `?tab=NAME.gp`). Each font gets a button that plays the same tab from the
 * same second, so the fonts can be compared by ear. Load time and the size of each font are printed for the decision note.
 * The effects switch flips the synth's EQ and room during playback, and the level readout (RMS of what the speakers get,
 * over the last 3 seconds) checks that effects on and off are equally loud on a normal mix (plan U3, KTD8).
 */
import { createSynthSession, type SynthSession } from '../src/audio/synth-bridge';
import { buildTimeline, loadScoreFromBytes } from '../src/model/alphatab-adapter';

const out = document.getElementById('out')!;
const say = (text: string) => {
  out.textContent = text;
};
const log: string[] = [];
const effectsSwitch = document.getElementById('effects') as HTMLInputElement;
const level = document.getElementById('level') as HTMLOutputElement;

/** Shows the RMS level of `node` in dBFS, averaged over the last few seconds. Returns a function that stops it. */
function meter(node: AudioNode): () => void {
  const analyser = node.context.createAnalyser();
  analyser.fftSize = 2048;
  node.connect(analyser);
  const frame = new Float32Array(analyser.fftSize);
  const recent: number[] = [];
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(frame);
    recent.push(frame.reduce((sum, x) => sum + x * x, 0) / frame.length);
    // 30 readings, 100 ms apart: the last 3 seconds
    if (recent.length > 30) recent.shift();
    const power = recent.reduce((a, b) => a + b, 0) / recent.length;
    level.value = power > 0 ? `${(10 * Math.log10(power)).toFixed(1)} dBFS (effects ${effectsSwitch.checked ? 'on' : 'off'})` : 'silent';
  }, 100);
  return () => {
    clearInterval(timer);
    node.disconnect(analyser);
    level.value = '-';
  };
}
const note = (line: string) => {
  log.push(line);
  say(log.join('\n'));
};

async function run() {
  const params = new URLSearchParams(location.search);
  const tabName = params.get('tab') ?? 'ozzy.gp';
  // The font list is fixed here on purpose: a long address gets cut off when it is copied between apps.
  const fonts = ['sonivox.sf3', 'MuseScore_General.sf3', 'GeneralUserGS.sf2'];

  const tabBytes = new Uint8Array(await (await fetch(`./local/${tabName}`)).arrayBuffer());
  const score = loadScoreFromBytes(tabBytes);
  const timeline = buildTimeline(score);
  note(`${tabName}: ${timeline.tracks.length} tracks, ${Math.round(timeline.durationSeconds)} s`);

  let current: SynthSession | null = null;
  let currentButton: HTMLButtonElement | null = null;
  let stopMeter = () => {};
  effectsSwitch.addEventListener('change', () => current?.clock.setEffects(effectsSwitch.checked));
  const start = document.getElementById('start') as HTMLInputElement;

  const stop = () => {
    stopMeter();
    stopMeter = () => {};
    current?.clock.pause();
    current?.clock.dispose();
    current = null;
    currentButton?.classList.remove('on');
    currentButton = null;
  };
  document.getElementById('stop')!.addEventListener('click', stop);

  const holder = document.getElementById('fonts')!;
  for (const font of fonts) {
    const button = document.createElement('button');
    button.textContent = `Play ${font}`;
    button.addEventListener('click', async () => {
      stop();
      currentButton = button;
      button.classList.add('on');
      const began = performance.now();
      // A wrong name makes the dev server answer with a web page, which alphaTab reports as "not a valid Soundfont2 file".
      const probe = await fetch(`./local/${font}`, { headers: { Range: 'bytes=0-11' } });
      const head = new TextDecoder().decode(new Uint8Array(await probe.arrayBuffer()).slice(0, 4));
      if (head !== 'RIFF') {
        note(`${font}: the server sent ${probe.status} "${head}" instead of a SoundFont, so the file name is wrong or the file is missing`);
        stop();
        return;
      }
      const session = createSynthSession(score, timeline.durationSeconds, timeline.tempoMap, {
        banks: [{ url: `./local/${font}` }],
        effects: effectsSwitch.checked,
      });
      current = session;
      try {
        await session.ready;
      } catch (e) {
        note(`${font}: failed to load (${e instanceof Error ? e.message : String(e)})`);
        return;
      }
      if (current !== session) return;
      note(`${font}: ready in ${Math.round(performance.now() - began)} ms`);
      if (session.output) stopMeter = meter(session.output);
      session.clock.seek(Number(start.value) || 0);
      session.clock.play();
    });
    holder.appendChild(button);
  }
}

run().catch((e) => say(`failed: ${e instanceof Error ? e.message : String(e)}`));
