/**
 * Dev-only: prints the level table for a bank, ready to paste into `src/audio/bank-manifest.ts` (not shipped, not a test).
 *
 *   node dev/measure-bank-levels.ts assets/soundfont/MuseScore_General.sf3
 *   node dev/measure-bank-levels.ts assets/soundfont/MuseScore_General.sf3 path/to/filtered-guitars.sf2
 *
 * Banks load in the order given, as the app layers them, so a later bank wins for the programs it covers. Measure a guitar
 * bank over MuseScore General and keep only the programs that bank covers: the rest are MuseScore General's own levels.
 * Node runs this file directly (it strips the types); there is no other TypeScript runner in the project.
 */
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

type BankLevels = typeof import('../src/audio/bank-levels');

const PROGRAMS = [24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34];
const NAMES: Record<number, string> = {
  24: 'nylon',
  25: 'steel',
  26: 'jazz',
  27: 'clean',
  28: 'muted',
  29: 'overdrive',
  30: 'distortion',
  31: 'harmonics',
  32: 'acoustic bass',
  33: 'fingered bass',
  34: 'picked bass',
};

async function main() {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    console.error('usage: node dev/measure-bank-levels.ts <bank.sf2|sf3> [more banks layered over it...]');
    process.exitCode = 1;
    return;
  }
  // Loaded by file URL with its extension, which plain Node needs and the app's bundler-style imports leave out.
  const levelsModule = new URL('../src/audio/bank-levels.ts', import.meta.url).href;
  const { measureLevels } = (await import(levelsModule)) as BankLevels;
  const banks = paths.map((path) => new Uint8Array(readFileSync(resolve(path))));
  const started = performance.now();
  const levels = measureLevels(banks, PROGRAMS);
  console.log(`// ${paths.map((path) => basename(path)).join(' + ')}`);
  console.log('{');
  for (const program of PROGRAMS) {
    const level = levels[program];
    const note = level < 1e-5 ? ' (silent: no bank plays it)' : '';
    console.log(`  ${program}: ${level.toFixed(4)}, // ${NAMES[program]}${note}`);
  }
  console.log('}');
  console.error(`measured in ${Math.round(performance.now() - started)} ms`);
}

void main();
