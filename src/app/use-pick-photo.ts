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
 * when there is one that loads, and the bundled photo otherwise (R18, R20). Loads are numbered: only the latest one to start may
 * set the photo, so a slow earlier load never overwrites a newer calibration, and a load that is out of date or unmounted frees its object URL.
 */
export function usePickPhoto(store: PickPhotoStore = defaultPickPhotoStore()): { readonly current: PickPhoto } {
  const photo = useRef<PickPhoto>({ image: null, profile: PICK_PROFILE });
  useEffect(() => {
    let alive = true;
    let latest = 0;
    let objectUrl: string | null = null;
    const release = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    };
    const load = async () => {
      const mine = ++latest;
      const stale = () => !alive || mine !== latest;
      const resolved = await resolvePickPhoto(store).catch(() => ({ source: 'bundled' as const, photo: null, profile: PICK_PROFILE }));
      if (stale()) return;
      let next: PickPhoto | null = null;
      let nextUrl: string | null = null;
      if (resolved.source === 'stored') {
        const url = URL.createObjectURL(resolved.photo);
        try {
          const image = await loadImage(url);
          if (stale()) {
            URL.revokeObjectURL(url);
            return;
          }
          next = { image, profile: resolved.profile };
          nextUrl = url;
        } catch {
          URL.revokeObjectURL(url);
          if (stale()) return;
        }
      }
      if (!next) {
        const image = await loadImage(bundledUrl).catch(() => null);
        if (stale()) return;
        next = { image, profile: PICK_PROFILE };
      }
      release();
      objectUrl = nextUrl;
      photo.current = next;
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
