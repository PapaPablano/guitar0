import { describe, expect, it } from 'vitest';
import { parseYoutubeLink } from '../../src/app/youtube-link';

const ID = 'dQw4w9WgXcQ';

describe('parseYoutubeLink', () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=42s`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}&list=RDAMVM${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abc`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `www.youtube.com/watch?v=${ID}`,
    `  https://youtu.be/${ID}  `,
    ID,
  ])('reads the video from %s', (link) => {
    expect(parseYoutubeLink(link)).toEqual({ ok: true, videoId: ID });
  });

  it('rejects a link that is not YouTube', () => {
    expect(parseYoutubeLink(`https://example.com/watch?v=${ID}`).ok).toBe(false);
  });

  it('rejects an empty string and text that is not a link', () => {
    expect(parseYoutubeLink('').ok).toBe(false);
    expect(parseYoutubeLink('   ').ok).toBe(false);
    expect(parseYoutubeLink('not a link at all').ok).toBe(false);
  });

  it('rejects a playlist-only link and says so', () => {
    const result = parseYoutubeLink('https://www.youtube.com/playlist?list=PL1234567890');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/playlist/);
  });

  it('rejects a video ID of the wrong length', () => {
    expect(parseYoutubeLink('https://youtu.be/short').ok).toBe(false);
  });
});
