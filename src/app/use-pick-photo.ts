import { useEffect, useRef } from 'react';
import bundledUrl from '../assets/pick-guitar-photo.jpg';
import { PICK_PROFILE, type NeckProfile } from '../render/neck-profile';
import { onPickPhotoChanged } from './pick-photo-events';
import { defaultPickPhotoStore, resolvePickPhoto, type PickPhotoStore } from './pick-photo-store';

/** What the pick view draws against: the photo once it has loaded (null until then) and the profile that goes with it. */
export interface PickPhoto {
  readonly image: HTMLImageElement | null;
  readonly profile: NeckProfile;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The guitar photo could not be loaded.'));
    image.src = src;
  });
}

/**
 * The pick view's current photo and profile, held in a ref so a frame loop can read it without re-rendering. It is the saved photo
 * when there is one that loads, and the bundled photo otherwise (R18, R20).
 */
export function usePickPhoto(store: PickPhotoStore = defaultPickPhotoStore()): { readonly current: PickPhoto } {
  const photo = useRef<PickPhoto>({ image: null, profile: PICK_PROFILE });
  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    const release = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    };
    const load = async () => {
      const resolved = await resolvePickPhoto(store).catch(() => ({ source: 'bundled' as const, photo: null, profile: PICK_PROFILE }));
      let next: PickPhoto | null = null;
      if (resolved.source === 'stored') {
        const url = URL.createObjectURL(resolved.photo);
        try {
          next = { image: await loadImage(url), profile: resolved.profile };
          release();
          objectUrl = url;
        } catch {
          URL.revokeObjectURL(url);
        }
      }
      if (!next) {
        release();
        next = { image: await loadImage(bundledUrl).catch(() => null), profile: PICK_PROFILE };
      }
      if (alive) photo.current = next;
    };
    void load();
    const stopListening = onPickPhotoChanged(() => void load());
    return () => {
      alive = false;
      stopListening();
      release();
    };
  }, [store]);
  return photo;
}
