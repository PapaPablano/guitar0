import { describe, expect, it } from 'vitest';
import { seekMarks } from '../../src/app/transport-marks';

describe('seekMarks', () => {
  it('places section labels and the loop band as percentages of the song', () => {
    const marks = seekMarks({
      durationSeconds: 200,
      sections: [
        { label: 'Intro', startSeconds: 0 },
        { label: 'Solo', startSeconds: 150 },
      ],
      loop: { startSeconds: 50, endSeconds: 100 },
    });
    expect(marks.sections).toEqual([
      { label: 'Intro', left: 0 },
      { label: 'Solo', left: 75 },
    ]);
    expect(marks.loop).toEqual({ left: 25, width: 25 });
  });

  it('clamps marks past the end and drops an empty loop', () => {
    const marks = seekMarks({ durationSeconds: 100, sections: [{ label: 'X', startSeconds: 150 }], loop: { startSeconds: 40, endSeconds: 40 } });
    expect(marks.sections[0].left).toBe(100);
    expect(marks.loop).toBeNull();
  });

  it('has nothing to show without a duration', () => {
    expect(seekMarks({ durationSeconds: 0, sections: [{ label: 'A', startSeconds: 0 }], loop: { startSeconds: 0, endSeconds: 1 } })).toEqual({ sections: [], loop: null });
  });
});
