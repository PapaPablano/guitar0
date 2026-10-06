import { useState } from 'react';
import type { SectionRow } from './section-controls';

interface SectionPanelProps {
  rows: readonly SectionRow[];
  onJump: (index: number) => void;
  onLoop: (index: number) => void;
  onRename: (index: number, name: string) => void;
}

/** The recording's parts: jump to one, loop one, rename one, and see how well each was matched. */
export function SectionPanel({ rows, onJump, onLoop, onRename }: SectionPanelProps) {
  const [editing, setEditing] = useState<{ index: number; draft: string } | null>(null);

  function commit() {
    if (editing) onRename(editing.index, editing.draft);
    setEditing(null);
  }

  return (
    <div className="sections" role="group" aria-label="Sections of the song">
      <ul className="section-list">
        {rows.map((row) => (
          <li key={row.index} className="section-row">
            {editing?.index === row.index ? (
              <input
                type="text"
                autoFocus
                value={editing.draft}
                maxLength={40}
                aria-label={`Name for ${row.label}`}
                onChange={(e) => setEditing({ index: row.index, draft: e.target.value })}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commit();
                  if (e.key === 'Escape') setEditing(null);
                }}
              />
            ) : (
              <strong className="section-name">{row.label}</strong>
            )}
            <span className="muted">{row.bars}</span>
            <span className={`readout readout-${row.readout.replace(' ', '-')}`}>{row.readout}</span>
            {row.landing && <span className="muted">{row.landing}</span>}
            <button type="button" onClick={() => onJump(row.index)} aria-label={`Jump to ${row.label}`}>
              Jump
            </button>
            <button type="button" onClick={() => onLoop(row.index)} aria-label={`Loop ${row.label}`}>
              Loop
            </button>
            <button type="button" onClick={() => setEditing({ index: row.index, draft: row.label === 'Whole song' || row.label.startsWith('Section ') ? '' : row.label })} aria-label={`Rename ${row.label}`}>
              Rename
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
