import { useState } from 'react';
import notices from '../../THIRD_PARTY_NOTICES.md?raw';

/** A "Licences" button that opens the third-party notices in place. */
export function Notices() {
  const [open, setOpen] = useState(false);
  return (
    <footer className="footer">
      <button type="button" className="link" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        Licences
      </button>
      {open && (
        <pre className="notices" tabIndex={0} aria-label="Third-party licences">
          {notices}
        </pre>
      )}
    </footer>
  );
}
