import bundledUrl from '../assets/pick-guitar-photo.jpg';
import { defaultPickPhotoStore, resolvePickPhoto, type PickPhotoStore } from '../app/pick-photo-store';
import { PICK_PROFILE, type NeckProfile } from '../render/neck-profile';

/** The pick view's photo as a bitmap the export worker can take, with the profile it was measured with. */
export interface PickPhotoBitmap {
  readonly photo: ImageBitmap;
  readonly profile: NeckProfile;
}

async function bundled(): Promise<PickPhotoBitmap> {
  const response = await fetch(bundledUrl);
  if (!response.ok) throw new Error('The guitar photo could not be loaded.');
  return { photo: await createImageBitmap(await response.blob()), profile: PICK_PROFILE };
}

/** The saved photo and its profile, or the bundled photo when none is saved or it cannot be decoded. */
export async function loadPickPhoto(store: PickPhotoStore = defaultPickPhotoStore()): Promise<PickPhotoBitmap> {
  const resolved = await resolvePickPhoto(store).catch(() => null);
  if (resolved?.source === 'stored') {
    try {
      return { photo: await createImageBitmap(resolved.photo), profile: resolved.profile };
    } catch {
      // a saved photo that will not decode falls back to the bundled one, like the live view
    }
  }
  return bundled();
}
