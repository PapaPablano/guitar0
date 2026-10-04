import { describe, expect, it } from 'vitest';
import { searchTextForSong, songsterrLinkForSong, songsterrSearchUrl } from '../../src/app/songsterr';
import { buildTimeline, loadAlphaTex } from '../../src/model/alphatab-adapter';

describe('songsterrSearchUrl', () => {
  it('builds Songsterr search page links with the text encoded', () => {
    expect(songsterrSearchUrl('master of puppets')).toBe('https://www.songsterr.com/?pattern=master%20of%20puppets');
    expect(songsterrSearchUrl('AC/DC & friends?')).toBe('https://www.songsterr.com/?pattern=AC%2FDC%20%26%20friends%3F');
  });

  it('collapses extra whitespace and trims', () => {
    expect(songsterrSearchUrl('  hello    world ')).toBe('https://www.songsterr.com/?pattern=hello%20world');
  });

  it('returns null for empty or blank text', () => {
    expect(songsterrSearchUrl('')).toBeNull();
    expect(songsterrSearchUrl('   ')).toBeNull();
  });
});

describe('searchTextForSong', () => {
  it('uses artist and title when both are present', () => {
    expect(searchTextForSong('Master of Puppets', 'Metallica')).toBe('Metallica Master of Puppets');
  });

  it('uses the title alone when there is no artist', () => {
    expect(searchTextForSong('Master of Puppets', '')).toBe('Master of Puppets');
    expect(searchTextForSong('Master of Puppets', '   ')).toBe('Master of Puppets');
  });

  it('gives nothing for empty or generic titles', () => {
    for (const title of ['', '   ', 'Untitled', 'untitled', 'Track 1', 'Unknown']) {
      expect(searchTextForSong(title, 'Metallica'), title).toBeNull();
    }
  });

  it('drops a generic artist but keeps the title', () => {
    expect(searchTextForSong('Real Song', 'Unknown')).toBe('Real Song');
  });
});

describe('songsterrLinkForSong with a loaded file', () => {
  it('links from the title and artist a file carries', () => {
    const timeline = buildTimeline(loadAlphaTex(String.raw`\title "Enter Sandman" \artist "Metallica" :4 0.6 0.6 0.6 0.6`));
    expect(timeline.artist).toBe('Metallica');
    expect(songsterrLinkForSong(timeline.title, timeline.artist)).toBe(
      'https://www.songsterr.com/?pattern=Metallica%20Enter%20Sandman',
    );
  });

  it('has no link for a file without a title', () => {
    const timeline = buildTimeline(loadAlphaTex(String.raw`:4 0.6 0.6 0.6 0.6`));
    expect(songsterrLinkForSong(timeline.title, timeline.artist)).toBeNull();
  });
});
