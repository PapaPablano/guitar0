/**
 * The score the synth plays, kept apart from the one the timeline and tab strip are built from (KTD4). It is a copy of the
 * loaded score in which each guitar track with palm-muted notes hands those notes to a companion track of its own. The
 * companion plays them with a muted preset on a channel of its own, so a palm mute is a real muted sample rather than the
 * track's normal sample cut short (R5, R6). Live playback and export both generate their MIDI from this score.
 */
import * as alphaTab from '@coderline/alphatab';
import { substituteUnplayablePrograms } from './font-substitutes';
import { isGuitarProgram, mutedSound, type MutedPresets } from './guitar-tone';

/** A companion track and the real track whose palm mutes it plays. Both are indices into the synth score's tracks. */
export interface Companion {
  readonly index: number;
  readonly parent: number;
}

export interface SynthScore {
  /** The copy alphaTab plays: the real tracks at their own indices, then the companions. */
  readonly score: alphaTab.model.Score;
  readonly companions: readonly Companion[];
}

/** The channel General MIDI keeps for drums; the score's own channels and alphaTab's metronome (16) are never handed out either. */
const DRUM_CHANNEL = 9;
const LAST_MELODIC_CHANNEL = 15;

type JsObject = Map<string, unknown>;

/** Note properties that name another note by id; a link to a note that moved to the other part is dropped. */
const NOTE_LINKS = [
  'tiedestinationnoteid',
  'tieoriginnoteid',
  'slurdestinationnoteid',
  'sluroriginnoteid',
  'hammerpulloriginnoteid',
  'hammerpulldestinationnoteid',
  'slidetargetnoteid',
  'slideoriginnoteid',
] as const;

/**
 * Builds the synth score for a loaded score, once per session. The loaded score is not changed.
 *
 * Each guitar track with palm-muted notes, while a channel is free, gets a companion appended after every real track: a full
 * copy of it with its open notes removed, while the parent loses its palm-muted notes. A tied note goes with the note its tie
 * starts from, so every note sounds exactly once. A part with no free channel keeps today's short palm mutes.
 */
export function buildSynthScore(original: alphaTab.model.Score, mutedPresets: MutedPresets = {}): SynthScore {
  const json = alphaTab.model.JsonConverter.scoreToJsObject(original);
  if (!json) throw new Error('The score could not be copied for the synth.');
  const tracksJson = json.get('tracks') as JsObject[];
  const free = freeChannels(original);
  let nextId = largestId(tracksJson) + 1;
  const planned: { parent: number; channel: number }[] = [];
  for (const track of original.tracks) {
    if (!wantsCompanion(track)) continue;
    const muted = mutedNoteIds(track);
    if (muted.size === 0) continue;
    const channel = free.shift();
    if (channel === undefined) break;
    const parentJson = tracksJson[track.index];
    const companionJson = structuredClone(parentJson);
    keepNotes(parentJson, (id) => !muted.has(id), false);
    keepNotes(companionJson, (id) => muted.has(id), true);
    nextId = renumber(companionJson, nextId);
    tracksJson.push(companionJson);
    planned.push({ parent: track.index, channel });
  }

  const score = alphaTab.model.JsonConverter.jsObjectToScore(json, new alphaTab.Settings());
  const companions = planned.map(({ parent, channel }, i): Companion => {
    const index = original.tracks.length + i;
    const companion = score.tracks[index];
    companion.name = `${companion.name} (palm mutes)`;
    // One channel for both, so the companion never shares a channel with its parent or anything else.
    companion.playbackInfo.primaryChannel = channel;
    companion.playbackInfo.secondaryChannel = channel;
    return { index, parent };
  });
  // Sounds the font has but alphaTab cannot play are swapped on this copy, before any tone choice is made.
  substituteUnplayablePrograms(score);
  deriveCompanionSounds(score.tracks, companions, mutedPresets);
  return { score, companions };
}

/**
 * Sets each companion's opening sound, and every instrument and bank change copied from its parent, to the muted preset for
 * the parent's sound at that point (KTD5). Runs again whenever a parent's sound changes, so a companion always follows it.
 */
export function deriveCompanionSounds(tracks: readonly alphaTab.model.Track[], companions: readonly Companion[], mutedPresets: MutedPresets = {}): void {
  for (const { index, parent: parentIndex } of companions) {
    const parent = tracks[parentIndex];
    const companion = tracks[index];
    if (!parent || !companion) continue;
    let program = parent.playbackInfo.program;
    let bank = parent.playbackInfo.bank;
    const opening = mutedSound(program, bank, mutedPresets);
    companion.playbackInfo.program = opening.program;
    companion.playbackInfo.bank = opening.bank;
    parent.staves.forEach((staff, s) =>
      staff.bars.forEach((bar, b) =>
        bar.voices.forEach((voice, v) =>
          voice.beats.forEach((beat, i) => {
            const target = companion.staves[s]?.bars[b]?.voices[v]?.beats[i];
            if (!target) return;
            const changes = beat.automations.filter(isSoundChange);
            for (const change of changes) {
              if (change.type === alphaTab.model.AutomationType.Instrument) program = change.value;
              else bank = change.value;
            }
            target.automations = withSound(target.automations, changes, mutedSound(program, bank, mutedPresets));
          }),
        ),
      ),
    );
  }
}

function isSoundChange(automation: alphaTab.model.Automation): boolean {
  return automation.type === alphaTab.model.AutomationType.Instrument || automation.type === alphaTab.model.AutomationType.Bank;
}

/**
 * A companion beat's automations with its sound changes replaced: none where the parent has none, else a bank select then a
 * program change, in that order because the synth applies a bank select at the next program change.
 */
function withSound(
  automations: alphaTab.model.Automation[],
  parentChanges: readonly alphaTab.model.Automation[],
  sound: { bank: number; program: number },
): alphaTab.model.Automation[] {
  const at = automations.findIndex(isSoundChange);
  const others = automations.filter((a) => !isSoundChange(a));
  if (parentChanges.length === 0) return at === -1 ? automations : others;
  const model = parentChanges[0];
  const bank = new alphaTab.model.Automation();
  bank.type = alphaTab.model.AutomationType.Bank;
  bank.isLinear = false;
  bank.ratioPosition = model.ratioPosition;
  bank.value = sound.bank;
  const instrument = alphaTab.model.Automation.buildInstrumentAutomation(false, model.ratioPosition, sound.program);
  const position = at === -1 ? 0 : Math.min(at, others.length);
  return [...others.slice(0, position), bank, instrument, ...others.slice(position)];
}

/** A melodic track that plays a guitar at some point, so its palm mutes can take a muted sound. */
function wantsCompanion(track: alphaTab.model.Track): boolean {
  if (track.isPercussion) return false;
  if (isGuitarProgram(track.playbackInfo.program)) return true;
  return beatsOf(track).some((beat) => beat.automations.some((a) => a.type === alphaTab.model.AutomationType.Instrument && isGuitarProgram(a.value)));
}

/** The ids of the notes the companion plays: every palm-muted note, and every note tied on from one. */
function mutedNoteIds(track: alphaTab.model.Track): Set<number> {
  const ids = new Set<number>();
  for (const beat of beatsOf(track))
    for (const note of beat.notes) {
      let head = note;
      while (head.tieOrigin && head.tieOrigin !== head) head = head.tieOrigin;
      if (head.isPalmMute) ids.add(note.id);
    }
  return ids;
}

function beatsOf(track: alphaTab.model.Track): alphaTab.model.Beat[] {
  return track.staves.flatMap((staff) => staff.bars.flatMap((bar) => bar.voices.flatMap((voice) => voice.beats)));
}

/** Channels 0 to 15 that no track uses, lowest first, leaving out the drum channel. */
function freeChannels(score: alphaTab.model.Score): number[] {
  const used = new Set<number>([DRUM_CHANNEL]);
  for (const track of score.tracks) {
    used.add(track.playbackInfo.primaryChannel);
    used.add(track.playbackInfo.secondaryChannel);
  }
  const free: number[] = [];
  for (let channel = 0; channel <= LAST_MELODIC_CHANNEL; channel++) if (!used.has(channel)) free.push(channel);
  return free;
}

function beatsJson(track: JsObject): JsObject[] {
  const beats: JsObject[] = [];
  for (const staff of (track.get('staves') as JsObject[] | undefined) ?? [])
    for (const bar of (staff.get('bars') as JsObject[] | undefined) ?? [])
      for (const voice of (bar.get('voices') as JsObject[] | undefined) ?? []) beats.push(...((voice.get('beats') as JsObject[] | undefined) ?? []));
  return beats;
}

/**
 * Keeps only the notes `keep` accepts, in a serialized track. Links to a removed note are dropped. A beat left without notes
 * becomes a rest that adds nothing to its channel; on a companion, a dead-slapped beat is the parent's to play.
 */
function keepNotes(track: JsObject, keep: (id: number) => boolean, companion: boolean): void {
  const kept = new Set<number>();
  const beats = beatsJson(track);
  for (const beat of beats) {
    const notes = (beat.get('notes') as JsObject[] | undefined) ?? [];
    const remaining = notes.filter((note) => keep(note.get('id') as number));
    for (const note of remaining) kept.add(note.get('id') as number);
    if (remaining.length !== notes.length) beat.set('notes', remaining);
    if (notes.length > 0 && remaining.length === 0) silence(beat);
    if (companion && beat.get('deadslapped')) beat.set('deadslapped', false);
  }
  for (const beat of beats)
    for (const note of (beat.get('notes') as JsObject[] | undefined) ?? [])
      for (const link of NOTE_LINKS) if (note.has(link) && !kept.has(note.get(link) as number)) note.delete(link);
}

/** Clears the beat effects that send MIDI of their own, so an emptied beat is a plain rest. */
function silence(beat: JsObject): void {
  beat.set('fade', alphaTab.model.FadeType.None);
  beat.set('vibrato', alphaTab.model.VibratoType.None);
  beat.set('whammybartype', alphaTab.model.WhammyType.None);
  beat.delete('whammybarpoints');
}

/** The largest bar, voice, beat or note id in the serialized tracks. */
function largestId(tracks: readonly JsObject[]): number {
  let largest = 0;
  const seen = (item: JsObject) => {
    const id = item.get('id');
    if (typeof id === 'number' && id > largest) largest = id;
  };
  for (const track of tracks)
    for (const staff of (track.get('staves') as JsObject[] | undefined) ?? [])
      for (const bar of (staff.get('bars') as JsObject[] | undefined) ?? []) {
        seen(bar);
        for (const voice of (bar.get('voices') as JsObject[] | undefined) ?? []) {
          seen(voice);
          for (const beat of (voice.get('beats') as JsObject[] | undefined) ?? []) {
            seen(beat);
            for (const note of (beat.get('notes') as JsObject[] | undefined) ?? []) seen(note);
          }
        }
      }
  return largest;
}

/**
 * Gives a copied track's bars, voices, beats and notes ids no other track has, keeping its notes' links to each other.
 * alphaTab links tied, slid and hammered notes by id across the whole score, so a copy keeping its parent's ids would link
 * into the parent. Returns the next unused id.
 */
function renumber(track: JsObject, firstId: number): number {
  let next = firstId;
  const noteIds = new Map<number, number>();
  const notes: JsObject[] = [];
  for (const staff of (track.get('staves') as JsObject[] | undefined) ?? [])
    for (const bar of (staff.get('bars') as JsObject[] | undefined) ?? []) {
      bar.set('id', next++);
      for (const voice of (bar.get('voices') as JsObject[] | undefined) ?? []) {
        voice.set('id', next++);
        for (const beat of (voice.get('beats') as JsObject[] | undefined) ?? []) {
          beat.set('id', next++);
          for (const note of (beat.get('notes') as JsObject[] | undefined) ?? []) {
            noteIds.set(note.get('id') as number, next);
            note.set('id', next++);
            notes.push(note);
          }
        }
      }
    }
  for (const note of notes)
    for (const link of NOTE_LINKS) {
      if (!note.has(link)) continue;
      const target = noteIds.get(note.get(link) as number);
      if (target === undefined) note.delete(link);
      else note.set(link, target);
    }
  return next;
}
