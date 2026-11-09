import type { PanelId } from '../app/stage-layout';
import type { Timeline } from '../model/score';
import { bassPickProfileFor, neckPhotoKind } from '../render/neck-profile';

/** Which photos a video of these panels, each drawing its own track, needs loaded. */
export interface PhotosNeeded {
  /** The guitar photo: a Real guitar view of a track that is not a 4-string bass. */
  readonly guitar: boolean;
  /** The bass photo: a Real guitar view or pick view of a 4-string track. */
  readonly bass: boolean;
  /** The user's pick-view photo: a pick view of any other track. */
  readonly pick: boolean;
}

export function photosNeeded(panels: readonly PanelId[], tracks: readonly number[], timeline: Timeline): PhotosNeeded {
  let guitar = false;
  let bass = false;
  let pick = false;
  panels.forEach((panel, i) => {
    const strings = timeline.tracks[tracks[i] ?? tracks[0] ?? 0]?.stringCount ?? 6;
    if (panel === 'neck') {
      if (neckPhotoKind(strings) === 'bass') bass = true;
      else guitar = true;
    } else if (panel === 'pick') {
      if (bassPickProfileFor(strings)) bass = true;
      else pick = true;
    }
  });
  return { guitar, bass, pick };
}
