import type { ReactNode } from 'react';
import { currentTool, TOOL_NAMES, type ToolId } from './practice-tools';

interface PracticeToolsProps {
  /** The tools that have something to show, with what each draws; only the chosen one is drawn. */
  tools: readonly { id: ToolId; panel: ReactNode }[];
  value: ToolId;
  onChange: (id: ToolId) => void;
  /** Tools with something to look at, marked on their chip so it is not missed while another tool is open. */
  attention?: readonly ToolId[];
}

/** A row of chips with one practice tool open under it, so the transport stays where it is. */
export function PracticeTools({ tools, value, onChange, attention = [] }: PracticeToolsProps) {
  const open = currentTool(value, tools.map((t) => t.id));
  return (
    <section className="practice-tools" aria-label="Practice tools">
      <div role="group" aria-label="Practice tool" className="tool-chips">
        {tools.map((t) => (
          <button
            key={t.id}
            type="button"
            className={attention.includes(t.id) ? 'attention' : undefined}
            aria-pressed={t.id === open}
            aria-label={attention.includes(t.id) ? `${TOOL_NAMES[t.id]}, needs a look` : undefined}
            onClick={() => onChange(t.id)}
          >
            {TOOL_NAMES[t.id]}
          </button>
        ))}
      </div>
      {/* Every panel stays mounted: stems keep a separation running and a schedule applied while another tool is open. */}
      {tools.map((t) => (
        <div key={t.id} className="tool-panel" hidden={t.id !== open}>
          {t.panel}
        </div>
      ))}
    </section>
  );
}
