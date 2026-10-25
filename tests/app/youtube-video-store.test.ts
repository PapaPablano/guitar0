import { describe, expect, it } from 'vitest';
import { YoutubeVideoStore, type KeyValueStorage } from '../../src/app/youtube-video-store';

function memory(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe('YoutubeVideoStore', () => {
  it('returns the video last attached to a tab and none for a tab with none', () => {
    const store = new YoutubeVideoStore(memory());
    store.attach('12:abcd', 'VIDEO000001');
    expect(store.videoFor('12:abcd')).toBe('VIDEO000001');
    expect(store.videoFor('other')).toBeNull();
  });

  it('restores a saved offset for the same tab and video, and not for the same tab with another video', () => {
    const store = new YoutubeVideoStore(memory());
    store.attach('tab', 'VIDEO000001');
    store.saveOffset('tab', 7.5);
    expect(store.offsetFor('tab')).toBe(7.5);
    store.attach('tab', 'VIDEO000002');
    expect(store.offsetFor('tab')).toBeNull();
    store.attach('tab', 'VIDEO000001');
    expect(store.offsetFor('tab')).toBe(7.5);
  });

  it('clears the attachment when the video is removed, and keeps its offset for next time', () => {
    const store = new YoutubeVideoStore(memory());
    store.attach('tab', 'VIDEO000001');
    store.saveOffset('tab', 3);
    store.detach('tab');
    expect(store.videoFor('tab')).toBeNull();
    store.attach('tab', 'VIDEO000001');
    expect(store.offsetFor('tab')).toBe(3);
  });

  it('removes the record when nothing is left to remember', () => {
    const storage = memory();
    const store = new YoutubeVideoStore(storage);
    store.attach('tab', 'VIDEO000001');
    store.detach('tab');
    expect(storage.data.size).toBe(0);
  });

  it('ignores a saved offset when no video is attached', () => {
    const store = new YoutubeVideoStore(memory());
    store.saveOffset('tab', 4);
    expect(store.offsetFor('tab')).toBeNull();
  });

  it('reads a record it cannot parse, or of another version, as nothing stored', () => {
    const storage = memory();
    storage.setItem('tab-highway-youtube:bad', '{not json');
    storage.setItem('tab-highway-youtube:old', JSON.stringify({ version: 99, videoId: 'x', offsets: {} }));
    const store = new YoutubeVideoStore(storage);
    expect(store.videoFor('bad')).toBeNull();
    expect(store.videoFor('old')).toBeNull();
  });

  it('keeps working for the session when saving fails', () => {
    const failing: KeyValueStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => undefined,
    };
    const store = new YoutubeVideoStore(failing);
    expect(() => store.attach('tab', 'VIDEO000001')).not.toThrow();
  });

  it('works with no storage at all', () => {
    const store = new YoutubeVideoStore(null);
    store.attach('tab', 'VIDEO000001');
    expect(store.videoFor('tab')).toBeNull();
  });

  it('clamps a stored offset that is outside the range', () => {
    const storage = memory();
    storage.setItem('tab-highway-youtube:tab', JSON.stringify({ version: 1, videoId: 'V', offsets: { V: 99 } }));
    expect(new YoutubeVideoStore(storage).offsetFor('tab')).toBe(30);
  });
});
