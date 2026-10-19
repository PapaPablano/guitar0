import { describe, expect, it } from 'vitest';
import { PICK_PROFILE, type NeckProfile } from '../../src/render/neck-profile';
import { PICK_PHOTO_VERSION, PickPhotoStore, resolvePickPhoto, type PickPhotoBackend } from '../../src/app/pick-photo-store';

/** An in-memory backend, so the store is tested without a browser database. */
function memoryBackend(initial: unknown = null): PickPhotoBackend & { value: unknown; fail: boolean } {
  const backend = {
    value: initial,
    fail: false,
    read: async () => {
      if (backend.fail) throw new Error('blocked');
      return backend.value;
    },
    write: async (value: unknown) => {
      if (backend.fail) throw new Error('blocked');
      backend.value = value;
    },
    remove: async () => {
      if (backend.fail) throw new Error('blocked');
      backend.value = null;
    },
  };
  return backend;
}

const calibrated: NeckProfile = { ...PICK_PROFILE, nutX: PICK_PROFILE.nutX + 7, fretX: PICK_PROFILE.fretX.map((x) => x + 7) };
const bytes = () => new Blob(['photo-bytes'], { type: 'image/jpeg' });

describe('the pick view photo store', () => {
  it('covers AE10: a saved photo and profile read back the same from a fresh store', async () => {
    const backend = memoryBackend();
    await new PickPhotoStore(backend).save(bytes(), calibrated);
    const loaded = await new PickPhotoStore(backend).load();
    expect(loaded?.profile).toEqual(calibrated);
    expect(await loaded?.photo.text()).toBe('photo-bytes');
  });

  it('covers AE11: with nothing stored, resolves to the bundled photo and PICK_PROFILE', async () => {
    const resolved = await resolvePickPhoto(new PickPhotoStore(memoryBackend()));
    expect(resolved).toEqual({ source: 'bundled', photo: null, profile: PICK_PROFILE });
  });

  it('covers AE11: after clearing, goes back to the bundled photo', async () => {
    const store = new PickPhotoStore(memoryBackend());
    await store.save(bytes(), calibrated);
    expect((await resolvePickPhoto(store)).source).toBe('stored');
    await store.clear();
    expect(await resolvePickPhoto(store)).toEqual({ source: 'bundled', photo: null, profile: PICK_PROFILE });
  });

  it('covers AE14: a blocked store reads as the bundled photo and reports a failed save without losing the previous record', async () => {
    const backend = memoryBackend();
    const store = new PickPhotoStore(backend);
    await store.save(bytes(), calibrated);
    backend.fail = true;
    await expect(store.save(bytes(), PICK_PROFILE)).rejects.toThrow();
    expect((await resolvePickPhoto(store)).source).toBe('bundled');
    backend.fail = false;
    expect((await store.load())?.profile).toEqual(calibrated);
  });

  it('reads a record with an unknown version, or a corrupt profile, as the bundled photo', async () => {
    const good = { version: PICK_PHOTO_VERSION, photo: bytes(), profile: calibrated };
    for (const bad of [
      { ...good, version: PICK_PHOTO_VERSION + 1 },
      { ...good, profile: { ...calibrated, fretX: 'many' } },
      { ...good, profile: { ...calibrated, stringKnotsY: [[1, 2]] } },
      { ...good, profile: { ...calibrated, nutX: Number.NaN } },
      { ...good, photo: 'not bytes' },
      'junk',
    ]) {
      expect((await resolvePickPhoto(new PickPhotoStore(memoryBackend(bad)))).source).toBe('bundled');
    }
    expect((await resolvePickPhoto(new PickPhotoStore(memoryBackend(good)))).source).toBe('stored');
  });

  it('covers AE10: leaves the Real guitar view alone — nothing it loads comes from this store', async () => {
    const backend = memoryBackend();
    await new PickPhotoStore(backend).save(bytes(), calibrated);
    const { NECK_PROFILE } = await import('../../src/render/neck-profile');
    expect(NECK_PROFILE).not.toEqual(calibrated);
    expect(NECK_PROFILE.pickX).toBeUndefined();
  });
});
