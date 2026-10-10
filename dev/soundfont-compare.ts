/**
 * Dev-only listening page for choosing the band SoundFont (not shipped, not a test: it has to be heard).
 * Serve with `npm run dev`, put the candidate fonts and a tab in `dev/local/`, then open
 * `/dev/soundfont-compare.html` (optionally `?tab=NAME.gp`). Each font gets a button that plays the same tab from the
 * same second, so the fonts can be compared by ear. Load time and the size of each font are printed for the decision note.
 */
import { createSynthSession, type SynthSession } from '../src/audio/synth-bridge';
import { buildTimeline, loadScoreFromBytes } from '../src/model/alphatab-adapter';

const out = document.getElementById('out')!;
const say = (text: string) => {
  out.textContent = text;
};
const log: string[] = [];
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
  const start = document.getElementById('start') as HTMLInputElement;

  const stop = () => {
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
      const session = createSynthSession(score, timeline.durationSeconds, timeline.tempoMap, { soundFontUrl: `./local/${font}` });
      current = session;
      try {
        await session.ready;
      } catch (e) {
        note(`${font}: failed to load (${e instanceof Error ? e.message : String(e)})`);
        return;
      }
      if (current !== session) return;
      note(`${font}: ready in ${Math.round(performance.now() - began)} ms`);
      session.clock.seek(Number(start.value) || 0);
      session.clock.play();
    });
    holder.appendChild(button);
  }
}

run().catch((e) => say(`failed: ${e instanceof Error ? e.message : String(e)}`));
