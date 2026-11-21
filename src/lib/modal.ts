// A modal's keyboard (Nov 21, keyboard pass): while it's open, focus is inside it. It moves in when the modal opens (the
// first control, or the box itself), Tab and Shift+Tab go round its own controls, Escape closes it, and when it closes
// focus goes back to whatever had it before (the button that opened it).
import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, summary, [tabindex]:not([tabindex="-1"])';
const shown = (el: HTMLElement) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
export const focusablesIn = (box: HTMLElement) => [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(shown);

/** Keep the keyboard inside `box` while `open`. `onClose` runs on Escape (leave it out when the modal has its own).
 *  `own`: the modal already moves focus in and back out itself (Team Chat); this only keeps Tab inside. */
export function useModalKeys(box: RefObject<HTMLElement | null>, open: boolean, onClose?: () => void, { own = false } = {}) {
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const before = own ? null : document.activeElement as HTMLElement | null;
    // focus in: the first control (a close button is fine), or the box itself
    const t = own ? 0 : requestAnimationFrame(() => {
      const el = box.current; if (!el || el.contains(document.activeElement)) return;
      const first = focusablesIn(el)[0];
      if (first) first.focus({ preventScroll: true });
      else { if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: true }); }
    });
    const onKey = (e: KeyboardEvent) => {
      const el = box.current; if (!el) return;
      // a dialog of its own opened from this one (an emoji picker, a message sheet) handles its own keys
      const a = document.activeElement;
      if (a && !el.contains(a) && a.closest('[role=dialog],[role=alertdialog]')) return;
      if (e.key === 'Escape' && close.current && !e.defaultPrevented) { e.preventDefault(); close.current(); return; }
      if (e.key !== 'Tab') return;
      const f = focusablesIn(el);
      if (!f.length) { e.preventDefault(); el.focus({ preventScroll: true }); return; }
      const at = f.indexOf(document.activeElement as HTMLElement);
      if (at < 0 || !el.contains(document.activeElement)) { e.preventDefault(); f[e.shiftKey ? f.length - 1 : 0].focus(); return; }
      if (e.shiftKey && at === 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && at === f.length - 1) { e.preventDefault(); f[0].focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      cancelAnimationFrame(t);
      document.removeEventListener('keydown', onKey, true);
      // back where it was (a button that's still on the page)
      if (before && before !== document.body && before.isConnected) requestAnimationFrame(() => before.focus({ preventScroll: true }));
    };
  }, [open, box, own]);
}
