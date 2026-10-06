import photoUrl from '../assets/guitar-photo.jpg';

/** Loads the guitar photo as a bitmap that can be handed to the export worker. */
export async function loadNeckPhoto(): Promise<ImageBitmap> {
  const response = await fetch(photoUrl);
  if (!response.ok) throw new Error('The guitar photo could not be loaded.');
  return createImageBitmap(await response.blob());
}
