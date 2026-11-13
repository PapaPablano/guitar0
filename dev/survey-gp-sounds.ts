/**
 * Dev-only survey for U9 of the realistic-guitar-sounds plan (not shipped, not a test).
 *
 *   node dev/survey-gp-sounds.ts                 every .gp file in dev/local/
 *   node dev/survey-gp-sounds.ts a.gp b.gp       just these files
 *
 * For each track's Guitar Pro sounds it prints the path, name, role and MIDI program, and flags a sound whose program is outside
 * the family its path names. Those flags are the only cases R16 would change. U9 was dropped on 2026-11-13 after this survey
 * found none; re-run it on new files if the question comes back. The family table is provisional, and paths it does not know
 * are listed. Node runs this file directly (it strips the types) and unzips with its own zlib, so it needs no dependency.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const GPIF = 'Content/score.gpif';
/** A real score.gpif is a few MB at most; anything larger is refused rather than inflated. */
const MAX_GPIF_BYTES = 64 * 1024 * 1024;

interface Family {
  readonly id: string;
  readonly programs: readonly number[];
}

/** Provisional: the last segment of a guitar or bass path, matched case-insensitively, to the programs of its family. */
const FAMILIES: readonly { readonly match: RegExp; readonly family: Family }[] = [
  { match: /^Stringed\/Electric Guitars\/.*(distortion|overdrive|crunch|lead|metal|hi-?gain)/i, family: { id: 'dirty electric', programs: [29, 30] } },
  { match: /^Stringed\/Electric Guitars\/.*(clean|jazz)/i, family: { id: 'clean electric', programs: [26, 27] } },
  { match: /^Stringed\/Acoustic Guitars\/.*(nylon|classical|flamenco)/i, family: { id: 'nylon acoustic', programs: [24] } },
  { match: /^Stringed\/Acoustic Guitars\/.*(steel|acoustic|12)/i, family: { id: 'steel acoustic', programs: [25] } },
  { match: /^Stringed\/Basses\//i, family: { id: 'bass', programs: [32, 33, 34] } },
];

interface SoundRow {
  readonly track: string;
  readonly path: string;
  readonly name: string;
  readonly role: string;
  readonly program: number;
}

function text(xml: string, tag: string): string {
  const m = new RegExp(`<${tag}>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))\\s*</${tag}>`).exec(xml);
  return (m?.[1] ?? m?.[2] ?? '').trim();
}

/** Reads one entry from a zip through its central directory, with Node's zlib. Enough for a .gp file; not a general unzipper. */
function readGpif(bytes: Buffer): string {
  const eocd = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0 || eocd + 22 > bytes.length) throw new Error('not a zip (a .gpx or older file?)');
  const entries = bytes.readUInt16LE(eocd + 10);
  let at = bytes.readUInt32LE(eocd + 16);
  for (let i = 0; i < entries; i++) {
    if (at + 46 > bytes.length || bytes.readUInt32LE(at) !== 0x02014b50) break;
    const method = bytes.readUInt16LE(at + 10);
    const packed = bytes.readUInt32LE(at + 20);
    const size = bytes.readUInt32LE(at + 24);
    const nameLength = bytes.readUInt16LE(at + 28);
    const next = at + 46 + nameLength + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
    const name = bytes.toString('utf8', at + 46, at + 46 + nameLength);
    if (name === GPIF) {
      if (size > MAX_GPIF_BYTES) throw new Error(`${GPIF} is over ${MAX_GPIF_BYTES / 1024 / 1024} MB`);
      const local = bytes.readUInt32LE(at + 42);
      if (local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50) throw new Error('broken zip entry');
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      const data = bytes.subarray(start, start + packed);
      if (method === 0) return data.toString('utf8');
      if (method === 8) return inflateRawSync(data, { maxOutputLength: MAX_GPIF_BYTES }).toString('utf8');
      throw new Error(`unsupported zip compression method ${method}`);
    }
    at = next;
  }
  throw new Error(`no ${GPIF}`);
}

function soundsOf(gpif: string): { sounds: SoundRow[]; soundChanges: number } {
  const sounds: SoundRow[] = [];
  let soundChanges = 0;
  for (const [track] of gpif.matchAll(/<Track id="[^"]*">[\s\S]*?<\/Track>/g)) {
    const trackName = text(track, 'Name');
    for (const [sound] of track.matchAll(/<Sound>[\s\S]*?<\/Sound>/g)) {
      const midi = /<MIDI>[\s\S]*?<\/MIDI>/.exec(sound)?.[0] ?? '';
      sounds.push({ track: trackName, path: text(sound, 'Path'), name: text(sound, 'Name'), role: text(sound, 'Role'), program: Number(text(midi, 'Program')) });
    }
    soundChanges += [...track.matchAll(/<Automation>\s*<Type>Sound<\/Type>/g)].length;
  }
  return { sounds, soundChanges };
}

function familyOf(path: string): Family | null {
  return FAMILIES.find((f) => f.match.test(path))?.family ?? null;
}

function filesToSurvey(args: string[]): string[] {
  if (args.length > 0) return args.map((a) => resolve(a));
  const dir = resolve('dev/local');
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.gp'))
    .map((f) => join(dir, f));
}

let disagreements = 0;
const unknownPaths = new Set<string>();
const files = filesToSurvey(process.argv.slice(2));
if (files.length === 0) console.log('No .gp files found in dev/local/.');

for (const file of files) {
  console.log(`\n${basename(file)}`);
  let parsed: ReturnType<typeof soundsOf>;
  try {
    parsed = soundsOf(readGpif(readFileSync(file)));
  } catch (error) {
    console.log(`  skipped: ${error instanceof Error ? error.message : String(error)}`);
    continue;
  }
  for (const s of parsed.sounds) {
    const family = familyOf(s.path);
    const guitarOrBass = s.path.startsWith('Stringed/');
    let verdict = '';
    if (family && !family.programs.includes(s.program)) {
      verdict = `  <-- program outside ${family.id} (${family.programs.join('/')})`;
      disagreements++;
    } else if (!family && guitarOrBass) {
      verdict = '  (path not in table)';
      unknownPaths.add(s.path);
    }
    console.log(`  ${s.track} | ${s.path} | ${s.name} | ${s.role} | program ${s.program}${verdict}`);
  }
  console.log(`  in-song sound changes: ${parsed.soundChanges}`);
}

console.log(`\n${files.length} file(s), ${disagreements} sound(s) whose program is outside their path's family.`);
if (unknownPaths.size > 0) console.log(`Guitar/bass paths not in the table:\n  ${[...unknownPaths].join('\n  ')}`);
