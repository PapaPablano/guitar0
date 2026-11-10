import type { UserBankView } from '../audio/user-bank';

interface UserBankControlProps {
  view: UserBankView;
  onPick: (file: File) => void;
  onRemove: () => void;
}

/** The More menu's guitar sounds row: the bundled sounds or the player's own bank, and the way to switch between them (R7, R8). */
export function UserBankControl({ view, onPick, onRemove }: UserBankControlProps) {
  if (view.kind === 'loaded' || view.kind === 'failed') {
    return (
      <div className="field">
        <span>
          Guitar sounds: {view.fileName}
          {view.kind === 'loaded' ? ` (${view.families})` : ' could not be loaded'}
        </span>
        <button type="button" onClick={onRemove}>
          Use bundled sounds
        </button>
      </div>
    );
  }
  const processing = view.kind === 'processing';
  return (
    <div className="field">
      <span>{processing ? 'Checking your sound bank…' : 'Guitar sounds: Bundled'}</span>
      {/* A label, not a button, so picking a file keeps the menu open (Menu closes on buttons and links). */}
      <label className="field">
        Load your own SF2/SF3…
        <input
          type="file"
          accept=".sf2,.sf3"
          disabled={processing}
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Cleared, so picking the same file again is still a change.
            e.target.value = '';
            if (file) onPick(file);
          }}
        />
      </label>
    </div>
  );
}
