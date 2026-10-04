export interface SupportEnvironment {
  readonly userAgent: string;
  readonly hasAudioContext: boolean;
  readonly hasAudioWorklet: boolean;
  readonly hasCanvas: boolean;
  /** Pointer is coarse (touch screen) and the viewport is narrow, as on a phone. */
  readonly isPhoneSized: boolean;
}

export interface Support {
  /** Practice mode needs audio and canvas. */
  readonly canPractice: boolean;
  /** A message to show above the app, or null when everything is fine. */
  readonly notice: string | null;
}

/** Decides what the page can promise in this browser. Export has its own check in the export module. */
export function assessSupport(env: SupportEnvironment): Support {
  if (!env.hasCanvas) {
    return { canPractice: false, notice: 'This browser cannot draw the highway. Please use a recent desktop browser.' };
  }
  if (!env.hasAudioContext || !env.hasAudioWorklet) {
    return { canPractice: false, notice: 'This browser cannot play the built-in sound. Please use a recent desktop browser.' };
  }
  if (env.isPhoneSized || /Android|iPhone|iPad|iPod/i.test(env.userAgent)) {
    return {
      canPractice: true,
      notice: 'Tab Highway is built for desktop browsers. Phones and tablets are not supported yet, so some controls may not fit.',
    };
  }
  return { canPractice: true, notice: null };
}

export function readSupportEnvironment(): SupportEnvironment {
  const canvas = typeof document !== 'undefined' && !!document.createElement('canvas').getContext;
  return {
    userAgent: navigator.userAgent,
    hasAudioContext: typeof AudioContext !== 'undefined',
    hasAudioWorklet: typeof AudioWorkletNode !== 'undefined',
    hasCanvas: canvas,
    isPhoneSized: window.matchMedia('(pointer: coarse) and (max-width: 820px)').matches,
  };
}
