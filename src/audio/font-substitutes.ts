import * as alphaTab from '@coderline/alphatab';

/**
 * Sounds MuseScore General has, but alphaTab cannot play. The font stores its grand pianos (programs 0, 1 and 3) and its rain
 * effect (96) as left and right halves, and alphaTab only plays mono samples: the halves are skipped, the notes come out as
 * invalid audio that silences the whole mix, and decoding them anyway takes over 40 seconds and is almost silent. These programs
 * play as a sound the font has in mono instead. 2 is the electric grand piano; 88 is a soft pad.
 */
export const FONT_SUBSTITUTES: Readonly<Record<number, number>> = {
  0: 2,
  1: 2,
  3: 2,
  96: 88,
};

/** The program to play instead of `program`, or `program` itself when the font can play it. */
export function playableProgram(program: number): number {
  return FONT_SUBSTITUTES[program] ?? program;
}

/**
 * Switches a score's unplayable programs, in its tracks and in every instrument change written into their beats, to the
 * stand-ins. Does it before any tone choice is made, so the stand-in is what the tab "wrote" as far as the player is concerned.
 * Percussion tracks are left alone: their program means nothing. Returns how many tracks were changed.
 */
export function substituteUnplayablePrograms(score: alphaTab.model.Score): number {
  let changed = 0;
  for (const track of score.tracks) {
    if (track.isPercussion) continue;
    let touched = false;
    const program = playableProgram(track.playbackInfo.program);
    if (program !== track.playbackInfo.program) {
      track.playbackInfo.program = program;
      touched = true;
    }
    for (const staff of track.staves)
      for (const bar of staff.bars)
        for (const voice of bar.voices)
          for (const beat of voice.beats)
            for (const automation of beat.automations) {
              if (automation.type !== alphaTab.model.AutomationType.Instrument) continue;
              const replacement = playableProgram(automation.value);
              if (replacement !== automation.value) {
                automation.value = replacement;
                touched = true;
              }
            }
    if (touched) changed++;
  }
  return changed;
}
