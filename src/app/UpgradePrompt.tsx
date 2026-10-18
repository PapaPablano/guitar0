import { useEffect, useRef } from 'react';
import { isDesktop } from './desktop';
import { FEATURE_NAMES, type ProFeature } from './tier';

interface UpgradePromptProps {
  /** The feature the player just reached; null hides the prompt. */
  feature: ProFeature | null;
  onClose: () => void;
}

/** Shown when a Free user reaches a Pro feature. It never touches the song, so playback and position carry on behind it. */
export function UpgradePrompt({ feature, onClose }: UpgradePromptProps) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (feature) close.current?.focus();
  }, [feature]);
  if (!feature) return null;
  return (
    <div className="overlay">
      <section className="dialog upgrade-prompt" role="dialog" aria-modal="true" aria-label="Tab Highway Pro">
        <h2>Tab Highway Pro</h2>
        <p>
          <strong>{FEATURE_NAMES[feature]}</strong> is included with Pro.
        </p>
        <p className="muted">
          Pro adds slowing down and customised practice, the real guitar and pick views, stem separation, and exports without a watermark.
          {isDesktop() ? '' : ' Get the Windows desktop app to subscribe.'}
        </p>
        <div className="actions">
          <button type="button" ref={close} onClick={onClose}>
            Not now
          </button>
        </div>
      </section>
    </div>
  );
}
