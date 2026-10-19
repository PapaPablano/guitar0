import { afterEach, describe, expect, it, vi } from 'vitest';
import { PickPhotoStore, type PickPhotoBackend } from '../../src/app/pick-photo-store';
import { loadPickPhoto } from '../../src/export/pick-photo';
import { NECK_PROFILE, PICK_PROFILE, type NeckProfile } from '../../src/render/neck-profile';

function memoryBackend(): PickPhotoBackend {
  let value: unknown = null;
  return {
    read: async () => value,
    write: async (v) => {
      value = v;
    },
    remove: async () => {
      value = null;
    },
  };
}

const calibrated: NeckProfile = { ...PICK_PROFILE, nutX: PICK_PROFILE.nutX + 9 };
const bundledBytes = new Blob(['bundled']);

/** createImageBitmap that gives back a marker for the blob it was given, and fails for blobs named in `bad`. */
function stubDecoding(bad: Blob[] = []) {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async (blob: Blob) => {
      if (bad.includes(blob)) throw new Error('cannot decode');
      return { from: blob } as unknown as ImageBitmap;
    }),
  );
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => bundledBytes })));
}

afterEach(() => vi.unstubAllGlobals());

describe('loading the pick view photo for an export', () => {
  it('covers AE11: uses the bundled photo and PICK_PROFILE when nothing is saved', async () => {
    stubDecoding();
    const loaded = await loadPickPhoto(new PickPhotoStore(memoryBackend()));
    expect(loaded.profile).toBe(PICK_PROFILE);
    expect((loaded.photo as unknown as { from: Blob }).from).toBe(bundledBytes);
  });

  it('covers AE10: uses the saved photo with its own profile, and never the Real guitar view profile', async () => {
    stubDecoding();
    const store = new PickPhotoStore(memoryBackend());
    const saved = new Blob(['mine']);
    await store.save(saved, calibrated);
    const loaded = await loadPickPhoto(store);
    expect((loaded.photo as unknown as { from: Blob }).from.size).toBe(saved.size);
    expect(loaded.profile).toEqual(calibrated);
    expect(loaded.profile).not.toEqual(NECK_PROFILE);
  });

  it('covers AE14: falls back to the bundled photo and its profile when the saved photo cannot be decoded', async () => {
    const store = new PickPhotoStore(memoryBackend());
    const saved = new Blob(['broken']);
    await store.save(saved, calibrated);
    const stored = (await store.load())!.photo;
    stubDecoding([stored]);
    const loaded = await loadPickPhoto(store);
    expect(loaded.profile).toBe(PICK_PROFILE);
    expect((loaded.photo as unknown as { from: Blob }).from).toBe(bundledBytes);
  });

  it('rejects when even the bundled photo cannot be fetched, so the export reports it instead of drawing nothing', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn());
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    await expect(loadPickPhoto(new PickPhotoStore(memoryBackend()))).rejects.toThrow(/could not be loaded/);
  });
});
