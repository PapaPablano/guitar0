import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';

interface MenuProps {
  /** What the closed menu button shows. */
  label: ReactNode;
  /** Read by screen readers when the label is only an icon. */
  ariaLabel?: string;
  className?: string;
  /** Called each time the panel opens, such as to read fresh contents for it. */
  onOpen?: () => void;
  /**
   * For a menu inside another menu's panel (KTD8): clicks in this panel stop here, so a button in it closes only this
   * menu and the one around it stays open.
   */
  keepParentOpen?: boolean;
  /** The panel's contents; a function is called with whether the panel is open, so costly contents can render only then. */
  children: ReactNode | ((open: boolean) => ReactNode);
}

/**
 * The `<details>` toggle listener: reports whether the panel is now open, and calls `onOpen` when it has just opened. A
 * toggle of a menu nested in the panel reaches this one through React too, and is ignored.
 */
export function menuToggleHandler(onOpen: (() => void) | undefined, onChange?: (open: boolean) => void) {
  return (e: SyntheticEvent<HTMLDetailsElement>) => {
    if (e.target !== e.currentTarget) return;
    const open = e.currentTarget.open;
    onChange?.(open);
    if (open) onOpen?.();
  };
}

/**
 * What a click in the panel does: a button or link closes the menu (a select or label keeps it open), and a nested menu
 * stops every click so the menu around it never sees it (KTD8).
 */
export function menuPanelClick(target: Pick<Element, 'closest'>, keepParentOpen: boolean): { close: boolean; stop: boolean } {
  return { close: target.closest('button, a') !== null, stop: keepParentOpen };
}

/**
 * Whether an Escape keydown closes this menu: only when it is open, no menu inside it is open (the innermost goes first),
 * and nothing else used the key already, such as a nested menu that just closed or the song rename input (KTD8).
 */
export function escapeCloses(e: Pick<KeyboardEvent, 'key' | 'defaultPrevented'>, details: Pick<HTMLDetailsElement, 'open' | 'querySelector'> | null): boolean {
  return e.key === 'Escape' && !e.defaultPrevented && !!details?.open && details.querySelector('details[open]') === null;
}

/**
 * A button that opens a small panel below it; Escape, a click outside, or a click on a button inside closes it. Escape and a
 * button click return focus to the menu button. With menus nested, Escape closes the innermost open one only.
 */
export function Menu({ label, ariaLabel, className, onOpen, keepParentOpen = false, children }: MenuProps) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const close = () => ref.current?.removeAttribute('open');
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (!escapeCloses(e, ref.current)) return;
      close();
      ref.current?.querySelector('summary')?.focus();
      // The menu around this one sees the key as used and stays open.
      e.preventDefault();
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
          const { close, stop } = menuPanelClick(e.target as HTMLElement, keepParentOpen);
          if (stop) e.stopPropagation();
          if (!close) return;
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
