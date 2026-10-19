/** A note's span in seconds: the part of a note the sounding rule needs. */
export interface NoteSpan {
  readonly startSeconds: number;
  readonly endSeconds: number;
}

/**
 * The one definition of "sounding", shared by every view: from the note's start up to, but not
 * including, its end. There is no minimum hold, so a note of no length is never sounding.
 */
export function isSounding(note: NoteSpan, t: number): boolean {
  return note.startSeconds <= t && t < note.endSeconds;
}
