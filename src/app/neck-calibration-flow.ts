import { calibrate, type CalibrationResult, type Point } from '../render/neck-calibration';
import type { PickPhotoStore } from './pick-photo-store';
import { pickPhotoChanged } from './pick-photo-events';

/** The frets a neck is assumed to have until the player says otherwise. */
export const DEFAULT_FRETS = 22;

type Fitted = Extract<CalibrationResult, { ok: true }>;

/** Where the calibration is: no photo yet, tapping the seven points on one, or looking at the fitted neck. Nothing is saved until Done. */
export type FlowState =
  | { readonly step: 'choosing'; readonly message: string | null }
  | { readonly step: 'tapping'; readonly photo: PhotoSize; readonly taps: readonly Point[]; readonly fretCount: number; readonly message: string | null }
  | { readonly step: 'preview'; readonly photo: PhotoSize; readonly taps: readonly Point[]; readonly fretCount: number; readonly result: Fitted };

export interface PhotoSize {
  readonly width: number;
  readonly height: number;
}

export type FlowAction =
  | { readonly type: 'photo'; readonly width: number; readonly height: number }
  | { readonly type: 'photoFailed'; readonly message: string }
  | { readonly type: 'tap'; readonly point: Point }
  | { readonly type: 'fretCount'; readonly count: number }
  | { readonly type: 'redo' };

export const initialFlow: FlowState = { step: 'choosing', message: null };

const TAP_COUNT = 7;

function fit(photo: PhotoSize, taps: readonly Point[], fretCount: number): CalibrationResult {
  return calibrate({
    taps: { nut: [taps[0], taps[1]], twelfth: [taps[2], taps[3]], last: [taps[4], taps[5]], pick: taps[6] },
    fretCount,
    photoWidth: photo.width,
    photoHeight: photo.height,
  });
}

export function flowReducer(state: FlowState, action: FlowAction): FlowState {
  switch (action.type) {
    case 'photo':
      return { step: 'tapping', photo: { width: action.width, height: action.height }, taps: [], fretCount: DEFAULT_FRETS, message: null };
    case 'photoFailed':
      return { step: 'choosing', message: action.message };
    case 'redo':
      return state.step === 'choosing' ? state : { step: 'tapping', photo: state.photo, taps: [], fretCount: state.fretCount, message: null };
    case 'fretCount': {
      if (state.step === 'tapping') return { ...state, fretCount: action.count };
      if (state.step !== 'preview') return state;
      const refit = fit(state.photo, state.taps, action.count);
      if (!refit.ok) return { step: 'tapping', photo: state.photo, taps: [], fretCount: action.count, message: refit.reason };
      return { ...state, fretCount: action.count, result: refit };
    }
    case 'tap': {
      if (state.step !== 'tapping') return state;
      const taps = [...state.taps, action.point];
      if (taps.length < TAP_COUNT) return { ...state, taps, message: null };
      const result = fit(state.photo, taps, state.fretCount);
      // taps that cannot be a neck start the taps again, saying why
      if (!result.ok) return { ...state, taps: [], message: result.reason };
      return { step: 'preview', photo: state.photo, taps, fretCount: state.fretCount, result };
    }
  }
}

/**
 * Saves the calibration: the turned photo with the profile fitted for it, as the pick view's current photo, and tells the views to
 * load it. Only a preview can be saved, so leaving the flow at any other step changes nothing.
 */
export async function commitCalibration(state: FlowState, turnedPhoto: Blob, store: Pick<PickPhotoStore, 'save'>): Promise<void> {
  if (state.step !== 'preview') throw new Error('Tap all seven points and check the preview first.');
  await store.save(turnedPhoto, state.result.profile);
  pickPhotoChanged();
}
