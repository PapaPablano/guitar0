import type { LoopBars } from '../render/tab-strip';

interface LoopControlsProps {
  barCount: number;
  loop: LoopBars | null;
  enabled: boolean;
  onChange: (loop: LoopBars | null) => void;
  onToggle: () => void;
}

function clampBar(value: number, barCount: number): number {
  return Math.min(barCount, Math.max(1, Math.round(value)));
}

export function LoopControls({ barCount, loop, enabled, onChange, onToggle }: LoopControlsProps) {
  const start = (loop?.startBar ?? 0) + 1;
  const end = (loop?.endBar ?? barCount - 1) + 1;

  function update(nextStart: number, nextEnd: number) {
    const s = clampBar(nextStart, barCount);
    const e = clampBar(nextEnd, barCount);
    onChange({ startBar: Math.min(s, e) - 1, endBar: Math.max(s, e) - 1 });
  }

  return (
    <div className="loop-controls" role="group" aria-label="Loop">
      <button type="button" aria-pressed={enabled} onClick={onToggle} disabled={!loop}>
        Loop {enabled ? 'on' : 'off'}
      </button>
      <label className="field">
        From bar
        <input type="number" min={1} max={barCount} value={start} onChange={(e) => update(Number(e.target.value), end)} />
      </label>
      <label className="field">
        to bar
        <input type="number" min={1} max={barCount} value={end} onChange={(e) => update(start, Number(e.target.value))} />
      </label>
      <button type="button" onClick={() => onChange(null)} disabled={!loop}>
        Clear loop
      </button>
    </div>
  );
}
