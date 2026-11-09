import { useEffect, useRef } from 'react';
import { NECK_PHOTO_URLS } from '../export/neck-photo';
import type { NeckPhotoKind } from '../render/neck-profile';

/** A neck photo, once it has loaded; null until then. Held in a ref so a frame loop can read it without re-rendering. */
export function useNeckPhoto(kind: NeckPhotoKind = 'guitar'): { readonly current: HTMLImageElement | null } {
  const photo = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    const image = new Image();
    image.src = NECK_PHOTO_URLS[kind];
    image.onload = () => {
      photo.current = image;
    };
  }, [kind]);
  return photo;
}
