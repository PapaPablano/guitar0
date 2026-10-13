import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { renderNeckFrame, type PhotoContext } from '../render/neck-view';
import { tapToPhoto, TAP_PROMPTS } from '../render/neck-calibration';
import { commitCalibration, flowReducer, initialFlow } from './neck-calibration-flow';
import { makeSampleTimeline } from './neck-calibration-sample';
import { normalizePhoto } from './normalize-photo';
import { pickPhotoChanged } from './pick-photo-events';
import { defaultPickPhotoStore, type PickPhotoStore } from './pick-photo-store';

interface NeckCalibrationProps {
  onClose: () => void;
  store?: PickPhotoStore;
}

/** Frets a player can say the neck has. */
const FRET_CHOICES = [20, 21, 22, 23, 24];
/** The longest side the tapping canvas is drawn at, in pixels. */
const TAP_CANVAS_LONG = 1400;
const MARK = '#9fe8ff';

/**
 * Calibrates the pick view's photo: choose a photo, tap seven points on it, check the preview and press Done. Nothing changes until Done,
 * so closing it at any step keeps the photo and profile in use.
 */
export function NeckCalibration({ onClose, store = defaultPickPhotoStore() }: NeckCalibrationProps) {
  const [state, dispatch] = useReducer(flowReducer, initialFlow);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const tapRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  function choose(file: File | undefined) {
    if (!file) return;
    setError(null);
    const url = URL.createObjectURL(file);
    const next = new Image();
    next.onload = () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = url;
      setImage(next);
      dispatch({ type: 'photo', width: next.naturalWidth, height: next.naturalHeight });
    };
    next.onerror = () => {
      URL.revokeObjectURL(url);
      dispatch({ type: 'photoFailed', message: 'That photo could not be read. Try a JPEG or PNG.' });
    };
    next.src = url;
  }

  // the photo with the taps so far marked
  useEffect(() => {
    const canvas = tapRef.current;
    if (!canvas || !image || state.step !== 'tapping') return;
    const scale = Math.min(1, TAP_CANVAS_LONG / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    ctx.font = `bold ${Math.max(14, Math.round(canvas.width / 60))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    state.taps.forEach((p, i) => {
      const r = Math.max(6, canvas.width / 150);
      ctx.beginPath();
      ctx.arc(p.x * scale, p.y * scale, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(2, 20, 26, 0.75)';
      ctx.fill();
      ctx.strokeStyle = MARK;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(String(i + 1), p.x * scale, p.y * scale - r * 2);
    });
  }, [image, state]);

  function tap(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!image || state.step !== 'tapping') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const point = tapToPhoto({ x: e.clientX, y: e.clientY }, rect, { width: image.naturalWidth, height: image.naturalHeight });
    if (point) dispatch({ type: 'tap', point });
  }

  // the turned photo, made once the neck is fitted, drawn in the preview and kept on Done
  const turned = useMemo(() => {
    if (state.step !== 'preview' || !image) return null;
    try {
      return normalizePhoto(image, state.result.normalize);
    } catch {
      return null;
    }
  }, [state, image]);

  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || state.step !== 'preview' || !turned) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const sample = makeSampleTimeline();
    const { profile } = state.result;
    let frame = 0;
    const draw = () => {
      const t = (performance.now() / 1000) % sample.durationSeconds;
      renderNeckFrame(ctx as unknown as PhotoContext, turned, sample, 0, t, canvas.width, canvas.height, { zoom: true, lookahead: 4, techniqueCues: true, profile });
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [state, turned]);

  async function done() {
    if (!turned) return;
    setSaving(true);
    setError(null);
    try {
      const blob = await new Promise<Blob>((resolve, reject) => turned.toBlob((b) => (b ? resolve(b) : reject(new Error('The photo could not be prepared.'))), 'image/jpeg', 0.9));
      await commitCalibration(state, blob, store);
      onClose();
    } catch (e) {
      setError(`The photo could not be saved, so the current one stays. ${e instanceof Error ? e.message : ''}`.trim());
    } finally {
      setSaving(false);
    }
  }

  async function useBundled() {
    setSaving(true);
    setError(null);
    try {
      await store.clear();
      pickPhotoChanged();
      onClose();
    } catch (e) {
      setError(`The bundled photo could not be restored. ${e instanceof Error ? e.message : ''}`.trim());
    } finally {
      setSaving(false);
    }
  }

  const message = state.step === 'choosing' || state.step === 'tapping' ? state.message : null;

  return (
    <div className="overlay">
      <section className="dialog calibration" role="dialog" aria-modal="true" aria-label="Calibrate guitar photo">
        <h2>Your guitar photo</h2>

        {state.step === 'choosing' && (
          <>
            <p>Choose a photo of your guitar taken from above, with the whole neck and the body past the pickup in view. It stays on this device.</p>
            <label className="field">
              Photo
              <input type="file" accept="image/*" onChange={(e) => choose(e.target.files?.[0])} />
            </label>
            <div className="actions">
              <button type="button" onClick={useBundled} disabled={saving}>
                Use the bundled photo
              </button>
              <button type="button" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}

        {state.step === 'tapping' && (
          <>
            <p aria-live="polite">
              <strong>
                Step {state.taps.length + 1} of {TAP_PROMPTS.length}.
              </strong>{' '}
              {TAP_PROMPTS[state.taps.length]}.
            </p>
            <label className="field">
              Frets on the neck
              <select value={state.fretCount} onChange={(e) => dispatch({ type: 'fretCount', count: Number(e.target.value) })}>
                {FRET_CHOICES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <canvas ref={tapRef} className="calibration-photo" onPointerDown={tap} role="img" aria-label="Your photo. Tap the point asked for." />
            <div className="actions">
              <button type="button" onClick={() => dispatch({ type: 'redo' })} disabled={state.taps.length === 0}>
                Start over
              </button>
              <button type="button" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}

        {state.step === 'preview' && (
          <>
            <p>This is how the guitar will look. The rings should sit between the fret wires and on the strings. If they do not, start over.</p>
            <label className="field">
              Frets on the neck
              <select value={state.fretCount} onChange={(e) => dispatch({ type: 'fretCount', count: Number(e.target.value) })}>
                {FRET_CHOICES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <canvas ref={previewRef} className="calibration-photo" width={960} height={480} role="img" aria-label="Preview of the calibrated guitar" />
            <div className="actions">
              <button type="button" onClick={() => dispatch({ type: 'redo' })} disabled={saving}>
                Redo
              </button>
              <button type="button" onClick={onClose} disabled={saving}>
                Cancel
              </button>
              <button type="button" className="primary" onClick={done} disabled={saving || !turned}>
                Done
              </button>
            </div>
          </>
        )}

        {(message || error) && (
          <p role="alert" className="error">
            {error ?? message}
          </p>
        )}
      </section>
    </div>
  );
}
