import { useEffect, useRef, type ReactNode } from 'react';

interface MenuProps {
  /** What the closed menu button shows. */
  label: ReactNode;
  /** Read by screen readers when the label is only an icon. */
  ariaLabel?: string;
  className?: string;
  children: ReactNode;
}

/** A button that opens a small panel below it; Escape, a click outside, or a click on a button inside closes it. */
export function Menu({ label, ariaLabel, className, children }: MenuProps) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = () => ref.current?.removeAttribute('open');
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && ref.current?.open) {
        close();
        ref.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, []);
  return (
    <details ref={ref} className={`menu ${className ?? ''}`}>
      <summary aria-label={ariaLabel}>{label}</summary>
      <div
        className="menu-panel"
        onClick={(e) => {
          // a button or link inside closes the menu; a select or label inside keeps it open
          if ((e.target as HTMLElement).closest('button, a')) ref.current?.removeAttribute('open');
        }}
      >
        {children}
      </div>
    </details>
  );
}
