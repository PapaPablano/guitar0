/**
 * A sound bank the player loads from their own device (R7 to R10). It is filtered like a bundled bank (KTD2), levelled once
 * when loaded (KTD6), kept in the browser's storage with its levels (KTD10), and layered last so its guitars and basses win
 * (KTD1). Nothing here touches React or IndexedDB: the storage, the level measurement and the session rebuild are passed in.
 */
import { BUNDLED_BANKS, bundledBankSources, PLAYER_RESERVED_BANK } from './bank-manifest';
import type { GuitarTone, MutedPresets } from './guitar-tone';
import { filterBank, type BankReport } from './soundfont-inspect';
import type { BankSource } from './synth-bridge';
import type { LevelTable } from './track-balance';

/** A bank larger than this is refused before it is read, so a stray huge file cannot exhaust the page's memory (KTD10). */
export const MAX_USER_BANK_BYTES = 512 * 1024 * 1024;

/** The slice of a picked `File` this module reads, so tests pass plain objects. */
export interface PickedFile {
  readonly name: string;
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * What is kept between sessions: the file as the player picked it, plus its report and measured levels so the costly
 * measurement is not repeated on reopen (KTD10). The original is kept rather than the filtered copy, so a reopen checks the
 * whole file again and a stored copy that went bad is caught before it reaches the synth.
 */
export interface StoredUserBank {
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly report: BankReport;
  readonly levels: LevelTable;
}

/** Where the player's bank is kept. `load` reads failures as nothing stored; `save` rejects when it cannot keep the bank. */
export interface UserBankStorage {
  load(): Promise<StoredUserBank | null>;
  save(bank: StoredUserBank): Promise<void>;
  clear(): Promise<void>;
}

/** The player's bank as the synth uses it: the filtered copy, what it covers and its levels. */
export interface ActiveUserBank {
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly report: BankReport;
  readonly levels: LevelTable;
}

/** What the More menu control shows. */
export type UserBankView =
  | { readonly kind: 'idle' }
  | { readonly kind: 'processing' }
  | { readonly kind: 'loaded'; readonly fileName: string; readonly families: string }
  | { readonly kind: 'failed'; readonly fileName: string };

/** A message for the header notice area; `offerRemove` adds a "Remove it" button beside Dismiss. */
export interface UserBankNotice {
  readonly text: string;
  readonly offerRemove: boolean;
}

export interface UserBankSnapshot {
  readonly view: UserBankView;
  readonly notice: UserBankNotice | null;
}

export interface UserBankDeps {
  storage: UserBankStorage;
  /** The bundled banks' bytes in layering order, for measuring the player's bank over them. */
  bundledBytes: () => Promise<Uint8Array[]>;
  /** `measureLevels` from `bank-levels.ts`. */
  measure: (banks: readonly Uint8Array[], programs: readonly number[]) => Record<number, number>;
  /** Resolves once the browser has painted, so "Checking your sound bank…" shows before the synchronous work. */
  nextFrame: () => Promise<void>;
  /** `setActiveLevels` from `track-balance.ts`. */
  setLevels: (tables: readonly LevelTable[]) => void;
  /** Rebuilds the open song's synth session with the current banks; does nothing when no song is open. */
  rebuild: () => void;
}

const FAMILY_NAMES: Readonly<Record<number, string>> = {
  24: 'Nylon acoustic',
  25: 'Steel acoustic',
  26: 'Jazz electric',
  27: 'Clean electric',
  28: 'Muted electric',
  29: 'Crunch electric',
  30: 'Distortion electric',
  31: 'Harmonics',
  32: 'Acoustic bass',
  33: 'Fingered bass',
  34: 'Picked bass',
};

const MUTED_NAMES: Readonly<Record<GuitarTone, string>> = {
  clean: 'Clean palm mute',
  crunch: 'Crunch palm mute',
  distortion: 'Distortion palm mute',
};

/** The sound family a General MIDI guitar or bass program is, as the player is told it. */
export function familyName(program: number): string {
  return FAMILY_NAMES[program] ?? `Program ${program}`;
}

/** What a bank plays, by sound family: its guitars and basses in program order, then its palm mutes. */
export function coveredFamilies(report: BankReport): string {
  const programs = [...new Set(report.covered.map((c) => c.program))].sort((a, b) => a - b);
  return [...programs.map(familyName), ...report.mutedCandidates.map((m) => MUTED_NAMES[m.tone])].join(', ');
}

/** True when a bank has something the synth would play from it: a guitar or bass, or a palm mute. */
function hasGuitarOrBass(report: BankReport): boolean {
  return report.covered.length > 0 || report.mutedCandidates.length > 0;
}

/** The palm-mute presets a bank offers, per tone (KTD5). */
export function mutedPresetsOf(report: BankReport): MutedPresets {
  const presets: Partial<Record<GuitarTone, { bank: number; program: number }>> = {};
  for (const m of report.mutedCandidates) presets[m.tone] = { bank: m.bank, program: m.program };
  return presets;
}

/** The banks and palm-mute presets a synth session is built with: the bundled banks, then the player's when there is one (KTD1). */
export function synthBankOptions(active: ActiveUserBank | null): { banks: BankSource[]; mutedPresets: MutedPresets } {
  return {
    banks: [...bundledBankSources(), ...(active ? [{ bytes: active.bytes }] : [])],
    mutedPresets: active ? mutedPresetsOf(active.report) : {},
  };
}

const bundledTables = (): LevelTable[] => BUNDLED_BANKS.map((bank) => bank.levels);

const STILL_BUNDLED = 'Bundled guitar sounds are still playing.';

/**
 * The player's bank, from picking or reopening to removing. Every change goes out through `subscribe`; a pick or remove that
 * changes the active bank sets the levels first, then asks for a rebuild, so the new session is levelled from its start.
 */
export class UserBankController {
  private current: ActiveUserBank | null = null;
  private state: UserBankSnapshot = { view: { kind: 'idle' }, notice: null };
  private readonly listeners = new Set<() => void>();
  /** True while a start, pick or remove runs; another one meanwhile is ignored, as the control is disabled then. */
  private busy = false;

  constructor(private readonly deps: UserBankDeps) {}

  snapshot(): UserBankSnapshot {
    return this.state;
  }

  /** The bank the synth plays from, or null for the bundled sounds only. */
  active(): ActiveUserBank | null {
    return this.current;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Reopens the stored bank. One that no longer loads is skipped but kept, and the player is offered to remove it (R8, R9). */
  async start(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const stored = await this.deps.storage.load();
      if (!stored) return;
      this.set({ view: { kind: 'processing' } });
      await this.deps.nextFrame();
      const result = filterBank(stored.bytes, { reservedBank: PLAYER_RESERVED_BANK });
      if (!result.ok || !hasGuitarOrBass(result.report)) {
        this.set({
          view: { kind: 'failed', fileName: stored.fileName },
          notice: {
            text: `Your sound bank "${stored.fileName}" could not be loaded, so the bundled guitar sounds are playing.`,
            offerRemove: true,
          },
        });
        return;
      }
      this.activate({ fileName: stored.fileName, bytes: result.bytes, report: result.report, levels: stored.levels }, null);
    } finally {
      this.busy = false;
    }
  }

  /** Checks, levels, keeps and switches to a bank the player picked; a file that cannot be used changes nothing (R7, R9, R10). */
  async pick(file: PickedFile): Promise<void> {
    if (this.busy) return;
    const name = file.name;
    if (file.size > MAX_USER_BANK_BYTES) {
      this.notify(`"${name}" is larger than 512 MB, so it was not loaded. ${STILL_BUNDLED}`);
      return;
    }
    this.busy = true;
    const before = this.state.view;
    const refuse = (text: string) => this.set({ view: before, notice: { text, offerRemove: false } });
    this.set({ view: { kind: 'processing' }, notice: null });
    try {
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await file.arrayBuffer());
      } catch {
        refuse(`"${name}" could not be read from your device. ${STILL_BUNDLED}`);
        return;
      }
      await this.deps.nextFrame();
      const result = filterBank(bytes, { reservedBank: PLAYER_RESERVED_BANK });
      if (!result.ok) {
        refuse(`"${name}" could not be read as an SF2 or SF3 sound bank: ${result.reason} ${STILL_BUNDLED}`);
        return;
      }
      if (!hasGuitarOrBass(result.report)) {
        refuse(`"${name}" has no guitar or bass sounds this app can play. ${STILL_BUNDLED}`);
        return;
      }
      let levels: LevelTable;
      try {
        const bundled = await this.deps.bundledBytes();
        levels = this.deps.measure([...bundled, result.bytes], [...new Set(result.report.covered.map((c) => c.program))]);
      } catch (e) {
        const why = e instanceof Error && e.message ? ` (${e.message})` : '';
        refuse(`"${name}" could not be checked${why}. ${STILL_BUNDLED}`);
        return;
      }
      let remembered = true;
      try {
        await this.deps.storage.save({ fileName: name, bytes, report: result.report, levels });
      } catch {
        remembered = false;
      }
      const families = coveredFamilies(result.report);
      const kept = remembered ? '' : " It won't be remembered after you close the app, because this browser's storage is unavailable.";
      this.activate(
        { fileName: name, bytes: result.bytes, report: result.report, levels },
        { text: `Guitar sounds from "${name}": ${families}.${kept}`, offerRemove: false },
      );
    } finally {
      this.busy = false;
    }
  }

  /** Forgets the player's bank and goes back to the bundled sounds (R8). */
  async remove(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      let notice: UserBankNotice | null = null;
      try {
        await this.deps.storage.clear();
      } catch {
        notice = {
          text: 'The bundled guitar sounds are playing, but your sound bank could not be removed from this browser, so it may come back next time.',
          offerRemove: false,
        };
      }
      const wasActive = this.current !== null;
      this.current = null;
      if (wasActive) this.deps.setLevels(bundledTables());
      this.set({ view: { kind: 'idle' }, notice });
      if (wasActive) this.deps.rebuild();
    } finally {
      this.busy = false;
    }
  }

  dismiss(): void {
    this.set({ notice: null });
  }

  private activate(bank: ActiveUserBank, notice: UserBankNotice | null): void {
    this.current = bank;
    this.deps.setLevels([...bundledTables(), bank.levels]);
    this.set({ view: { kind: 'loaded', fileName: bank.fileName, families: coveredFamilies(bank.report) }, notice });
    this.deps.rebuild();
  }

  private notify(text: string): void {
    this.set({ notice: { text, offerRemove: false } });
  }

  private set(next: Partial<UserBankSnapshot>): void {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }
}

/** The parts of a clock a rebuild needs: where it is and whether it plays, and a way to stop it. */
interface PlacedClock {
  readonly playing: boolean;
  time(): number;
  pause(): void;
}

/**
 * Pauses the clock the page follows and remembers where it was, so a rebuilt sound can carry on from the same playhead.
 * `restore` seeks the new clock there and plays it again if it was playing.
 */
export function holdPlace(clock: PlacedClock | undefined): {
  readonly position: number;
  readonly playing: boolean;
  restore(next: { seek(seconds: number): void; play(): void }): void;
} {
  const position = clock?.time() ?? 0;
  const playing = clock?.playing ?? false;
  clock?.pause();
  return {
    position,
    playing,
    restore(next) {
      next.seek(position);
      if (playing) next.play();
    },
  };
}
