import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';

interface MenuProps {
  /** What the closed menu button shows. */
  label: ReactNode;
  /** Read by screen readers when the label is only an icon. */
  ariaLabel?: string;
  className?: string;
  /** Called each time the panel opens, such as to read fresh contents for it. */
  onOpen?: () => void;
  /** The panel's contents; a function is called with whether the panel is open, so costly contents can render only then. */
  children: ReactNode | ((open: boolean) => ReactNode);
}

/** The `<details>` toggle listener: reports whether the panel is now open, and calls `onOpen` when it has just opened. */
export function menuToggleHandler(onOpen: (() => void) | undefined, onChange?: (open: boolean) => void) {
  return (e: SyntheticEvent<HTMLDetailsElement>) => {
    const open = e.currentTarget.open;
    onChange?.(open);
    if (open) onOpen?.();
  };
}

/**
 * A button that opens a small panel below it; Escape, a click outside, or a click on a button inside closes it. Escape and a
 * button click return focus to the menu button.
 */
export function Menu({ label, ariaLabel, className, onOpen, children }: MenuProps) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
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
    <details ref={ref} className={`menu ${className ?? ''}`} onToggle={menuToggleHandler(onOpen, setOpen)}>
      <summary
        aria-label={ariaLabel}
        onClick={() => {
          // the toggle event comes a task after the panel opens, so contents that render only while open are drawn now
          if (!ref.current?.open) setOpen(true);
        }}
      >
        {label}
      </summary>
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
        {typeof children === 'function' ? children(open) : children}
      </div>
    </details>
  );
}
