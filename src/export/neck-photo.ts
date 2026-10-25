import guitarUrl from '../assets/guitar-photo.jpg';
import bassUrl from '../assets/bass-photo.jpg';
import type { NeckPhotoKind } from '../render/neck-profile';

/** The bundled Real guitar view photos, by the kind of neck they show. */
export const NECK_PHOTO_URLS: Record<NeckPhotoKind, string> = { guitar: guitarUrl, bass: bassUrl };

/** Loads a Real guitar view photo as a bitmap that can be handed to the export worker. */
export async function loadNeckPhoto(kind: NeckPhotoKind = 'guitar'): Promise<ImageBitmap> {
  const response = await fetch(NECK_PHOTO_URLS[kind]);
  if (!response.ok) throw new Error(`The ${kind} photo could not be loaded.`);
  return createImageBitmap(await response.blob());
}
