import { useEffect, useRef, type ReactNode, type SyntheticEvent } from 'react';

interface MenuProps {
  /** What the closed menu button shows. */
  label: ReactNode;
  /** Read by screen readers when the label is only an icon. */
  ariaLabel?: string;
  className?: string;
  /** Called each time the panel opens, such as to read fresh contents for it. */
  onOpen?: () => void;
  children: ReactNode;
}

/** The `<details>` toggle listener: calls `onOpen` when the panel has just opened. */
export function menuToggleHandler(onOpen: (() => void) | undefined) {
  return (e: SyntheticEvent<HTMLDetailsElement>) => {
    if (e.currentTarget.open) onOpen?.();
  };
}

/**
 * A button that opens a small panel below it; Escape, a click outside, or a click on a button inside closes it. Escape and a
 * button click return focus to the menu button.
 */
export function Menu({ label, ariaLabel, className, onOpen, children }: MenuProps) {
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
    <details ref={ref} className={`menu ${className ?? ''}`} onToggle={menuToggleHandler(onOpen)}>
      <summary aria-label={ariaLabel}>{label}</summary>
      <div
        className="menu-panel"
        onClick={(e) => {
          // a button or link inside closes the menu; a select or label inside keeps it open
          if (!(e.target as HTMLElement).closest('button, a')) return;
          ref.current?.removeAttribute('open');
          // the clicked control is hidden with the panel, so focus goes back to the menu button, as Escape does
          ref.current?.querySelector('summary')?.focus();
        }}
      >
        {children}
      </div>
    </details>
  );
}
