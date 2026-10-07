import { useEffect, useRef } from 'react';
import photoUrl from '../assets/guitar-photo.jpg';

/** The guitar photo, once it has loaded; null until then. Held in a ref so a frame loop can read it without re-rendering. */
export function useNeckPhoto(): { readonly current: HTMLImageElement | null } {
  const photo = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    const image = new Image();
    image.src = photoUrl;
    image.onload = () => {
      photo.current = image;
    };
  }, []);
  return photo;
}
