export interface SeekMarksInput {
  readonly durationSeconds: number;
  /** Named sections to label along the seek bar, by where each starts. */
  readonly sections: readonly { readonly label: string; readonly startSeconds: number }[];
  /** The looped stretch in tab seconds, or null when no loop is on. */
  readonly loop: { readonly startSeconds: number; readonly endSeconds: number } | null;
}

export interface SeekMarks {
  readonly sections: readonly { readonly label: string; readonly left: number }[];
  /** Where the loop band sits, as percentages of the bar's width. */
  readonly loop: { readonly left: number; readonly width: number } | null;
}

function percent(seconds: number, duration: number): number {
  return Math.min(100, Math.max(0, (seconds / duration) * 100));
}

/** Where the section labels and the loop band sit along the seek bar, as percentages of its width. */
export function seekMarks({ durationSeconds, sections, loop }: SeekMarksInput): SeekMarks {
  if (!(durationSeconds > 0)) return { sections: [], loop: null };
  const left = loop ? percent(loop.startSeconds, durationSeconds) : 0;
  const right = loop ? percent(loop.endSeconds, durationSeconds) : 0;
  return {
    sections: sections.map((s) => ({ label: s.label, left: percent(s.startSeconds, durationSeconds) })),
    loop: loop && right > left ? { left, width: right - left } : null,
  };
}
