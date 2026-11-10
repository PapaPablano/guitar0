/**
 * Dev-only listening page for choosing the bundled guitar and bass banks (plan U4; not shipped, not a test: it has to be heard).
 * Run `npm run dev`, then open `/dev/soundfont-compare.html` (optionally `?tab=NAME.gp`, a tab in `dev/local/`).
 *
 * The A/B plays the same tab from the same second through two sets:
 *  - A: MuseScore General alone, at its manifest levels, as the app plays today;
 *  - B: MuseScore General with the ticked files from `dev/local/prepared/` (made by `scripts/prepare-bank.ts`) layered over
 *    it, each filtered as the app filters a bank (KTD2) and levelled from the reference riff measured over the same banks
 *    (KTD6), so A and B are compared at matched loudness.
 * The effects switch starts off, so the samples are heard dry; it flips the synth's EQ and room during playback. The level
 * readout (RMS of what the speakers get, over the last 3 seconds) checks loudness by numbers as well as by ear.
 * The older whole-font buttons play other fonts put in `dev/local/`, at MuseScore General's levels.
 */
import { BUNDLED_BANKS, bundledBankSources, bundledBankUrls } from '../src/audio/bank-manifest';
import { measureLevels } from '../src/audio/bank-levels';
import { loadSoundFontBytes } from '../src/audio/soundfont-cache';
import { filterBank } from '../src/audio/soundfont-inspect';
import { createSynthSession, type BankSource, type SynthSession } from '../src/audio/synth-bridge';
import { programGain, setActiveLevels, type LevelTable } from '../src/audio/track-balance';
import { buildTimeline, loadScoreFromBytes } from '../src/model/alphatab-adapter';

/** The prepared files, one per family, as `scripts/prepare-bank.ts` writes them. Fixed here: long addresses get cut off. */
const PREPARED = ['guitar-clean.sf3', 'guitar-distortion.sf3', 'bass-finger.sf3', 'bass-picked.sf3'];
/** Whole fonts for the older comparison, played alone. */
const OTHER_FONTS = ['sonivox.sf3', 'MuseScore_General.sf3', 'GeneralUserGS.sf2'];
/** Each prepared file's palm-mute presets would move here (none of them has any); distinct per file, as KTD2 asks. */
const FIRST_RESERVED_BANK = 301;

const out = document.getElementById('out')!;
const log: string[] = [];
const note = (line: string) => {
  log.push(line);
  out.textContent = log.join('\n');
};
const effectsSwitch = document.getElementById('effects') as HTMLInputElement;
const level = document.getElementById('level') as HTMLOutputElement;
const start = document.getElementById('start') as HTMLInputElement;

/** Shows the RMS level of `node` in dBFS, averaged over the last few seconds. Returns a function that stops it. */
function meter(node: AudioNode, label: string): () => void {
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
    const effects = `effects ${effectsSwitch.checked ? 'on' : 'off'}`;
    level.value = power > 0 ? `${(10 * Math.log10(power)).toFixed(1)} dBFS (${label}, ${effects})` : 'silent';
  }, 100);
  return () => {
    clearInterval(timer);
    node.disconnect(analyser);
    level.value = '-';
  };
}

/**
 * The bytes at `url` (only the first 12 with `probe`), or null, with a note, when the dev server sent something other than
 * a SoundFont: a wrong name makes it answer with a web page, which alphaTab reports as "not a valid Soundfont2 file".
 */
async function fetchBank(url: string, probe = false): Promise<Uint8Array | null> {
  const response = await fetch(url, probe ? { headers: { Range: 'bytes=0-11' } } : undefined);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const head = new TextDecoder().decode(bytes.slice(0, 4));
  if (head === 'RIFF') return bytes;
  note(`${url}: the server sent ${response.status} "${head}" instead of a SoundFont, so the file is missing or misnamed`);
  return null;
}

const bundledLevels = (): LevelTable[] => BUNDLED_BANKS.map((bank) => bank.levels);

/** Set B for the ticked files: banks to layer and the levels measured over them, cached per selection. */
const setB = new Map<string, { banks: BankSource[]; levels: LevelTable }>();

async function prepareSetB(files: readonly string[]): Promise<{ banks: BankSource[]; levels: LevelTable } | null> {
  const key = files.join(',');
  const known = setB.get(key);
  if (known) return known;
  const base = await Promise.all(BUNDLED_BANKS.map((bank) => loadSoundFontBytes(bank.url, undefined, undefined, bundledBankUrls())));
  const layered: Uint8Array[] = [];
  const programs = new Set<number>();
  for (const [i, file] of files.entries()) {
    const bytes = await fetchBank(`./local/prepared/${file}`);
    if (!bytes) return null;
    const result = filterBank(bytes, { reservedBank: FIRST_RESERVED_BANK + i });
    if (!result.ok) {
      note(`${file}: ${result.reason}`);
      return null;
    }
    const covered = result.report.covered.map((c) => `${c.program} "${c.name}"`).join(', ') || 'nothing';
    const rejected = result.report.rejected.filter((r) => r.reason !== 'missing').map((r) => `${r.program} (${r.reason})`);
    note(`${file}: ${(bytes.length / 1024 / 1024).toFixed(2)} MiB, covers ${covered}${rejected.length ? `, rejects ${rejected.join(', ')}` : ''}`);
    for (const c of result.report.covered) programs.add(c.program);
    layered.push(result.bytes);
  }
  // Synchronous: about a second per program while alphaTab parses MuseScore General and decodes the samples.
  const began = performance.now();
  const levels = measureLevels([...base, ...layered], [...programs].sort((a, b) => a - b));
  const rows = Object.entries(levels).map(([program, value]) => {
    const p = Number(program);
    const before = BUNDLED_BANKS[0].levels[p];
    return `  ${p}: ${value.toFixed(4)} (MuseScore General ${before?.toFixed(4) ?? '-'}), gain B ${programGain(p, { ...BUNDLED_BANKS[0].levels, ...levels }).toFixed(2)} vs A ${programGain(p, BUNDLED_BANKS[0].levels).toFixed(2)}`;
  });
  note(`levels measured in ${Math.round(performance.now() - began)} ms:\n${rows.join('\n')}`);
  const set = { banks: [...bundledBankSources(), ...layered.map((bytes) => ({ bytes }))], levels };
  setB.set(key, set);
  return set;
}

async function run() {
  const params = new URLSearchParams(location.search);
  const tabName = params.get('tab') ?? 'ozzy.gp';
  const tabBytes = new Uint8Array(await (await fetch(`./local/${tabName}`)).arrayBuffer());
  const score = loadScoreFromBytes(tabBytes);
  const timeline = buildTimeline(score);
  note(`${tabName}: ${timeline.tracks.length} tracks, ${Math.round(timeline.durationSeconds)} s`);

  let current: SynthSession | null = null;
  let currentButton: HTMLButtonElement | null = null;
  let stopMeter = () => {};
  effectsSwitch.addEventListener('change', () => current?.clock.setEffects(effectsSwitch.checked));

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

  /** Plays the tab through `banks` with `levels` active, from the start second. */
  const play = async (button: HTMLButtonElement, label: string, banks: BankSource[], levels: LevelTable[], keep?: string[]) => {
    const began = performance.now();
    setActiveLevels(levels);
    const session = createSynthSession(score, timeline.durationSeconds, timeline.tempoMap, {
      banks,
      keep,
      effects: effectsSwitch.checked,
    });
    current = session;
    currentButton = button;
    button.classList.add('on');
    try {
      await session.ready;
    } catch (e) {
      note(`${label}: failed to load (${e instanceof Error ? e.message : String(e)})`);
      return;
    }
    if (current !== session) return;
    note(`${label}: ready in ${Math.round(performance.now() - began)} ms`);
    if (session.output) stopMeter = meter(session.output, label);
    session.clock.seek(Number(start.value) || 0);
    session.clock.play();
  };

  const picks = document.getElementById('prepared')!;
  const boxes = PREPARED.map((file) => {
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = true;
    box.value = file;
    label.append(box, ` ${file}`);
    picks.appendChild(label);
    return box;
  });

  const playA = document.getElementById('play-a') as HTMLButtonElement;
  playA.addEventListener('click', () => {
    stop();
    void play(playA, 'A: MuseScore General', bundledBankSources(), bundledLevels(), bundledBankUrls());
  });
  const playB = document.getElementById('play-b') as HTMLButtonElement;
  playB.addEventListener('click', async () => {
    stop();
    const files = boxes.filter((b) => b.checked).map((b) => b.value);
    if (files.length === 0) {
      note('B: tick at least one prepared file');
      return;
    }
    playB.disabled = true;
    note(`B: measuring ${files.join(' + ')} over MuseScore General...`);
    // A frame first, so the note paints before the synchronous measurement.
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
    try {
      const set = await prepareSetB(files);
      if (set) await play(playB, `B: + ${files.join(' + ')}`, set.banks, [...bundledLevels(), set.levels], bundledBankUrls());
    } finally {
      playB.disabled = false;
    }
  });

  const holder = document.getElementById('fonts')!;
  for (const font of OTHER_FONTS) {
    const button = document.createElement('button');
    button.textContent = `Play ${font}`;
    button.addEventListener('click', async () => {
      stop();
      if (!(await fetchBank(`./local/${font}`, true))) return;
      // Keeping the bundled URLs stops this font's download from evicting MuseScore General from the cache.
      void play(button, font, [{ url: `./local/${font}` }], bundledLevels(), [...bundledBankUrls(), `./local/${font}`]);
    });
    holder.appendChild(button);
  }
}

run().catch((e) => note(`failed: ${e instanceof Error ? e.message : String(e)}`));
