import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * While the component using it is mounted: puts focus inside `ref`, keeps Tab and Shift+Tab inside
 * it, calls `onEscape` on Esc, and gives focus back to what had it before. Mount it only while the
 * dialog is open.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, onEscape: () => void) {
  const escape = useRef(onEscape);
  escape.current = onEscape;

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const before = document.activeElement as HTMLElement | null;
    const items = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.getAttribute('aria-hidden') !== 'true',
      );
    (items()[0] ?? container).focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        escape.current();
        return;
      }
      if (event.key !== 'Tab' || !container) return;
      const all = items();
      if (all.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = all[0] as HTMLElement;
      const last = all[all.length - 1] as HTMLElement;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !container.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !container.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      before?.focus?.();
    };
  }, [ref]);
}
