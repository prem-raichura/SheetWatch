import { ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";
import { m } from "motion/react";
import { useScrollLock } from "../hooks/useScrollLock";

const SCRIM = "fixed inset-0 z-[100] flex bg-black/50 backdrop-blur-[3px]";

// Lock body scroll (ref-counted, stack-safe) + close on Escape while mounted.
function useModalEffects(onClose: () => void) {
  useScrollLock();
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
}

interface ShellProps {
  onClose: () => void;
  children: ReactNode;
  maxWidth?: string; // tailwind max-w-* class
  label?: string; // accessible name for the dialog
}

// Centered dialog — portaled to <body> so it escapes any transformed ancestor.
export function ModalShell({ onClose, children, maxWidth = "max-w-md", label }: ShellProps) {
  useModalEffects(onClose);
  return createPortal(
    <m.div
      className={`${SCRIM} items-center justify-center p-4`}
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
    >
      <m.div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`w-full overflow-hidden rounded-2xl bg-card shadow-[0_24px_70px_-20px_rgba(11,16,32,0.45)] ${maxWidth}`}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 12, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 500, damping: 36 }}
      >
        {children}
      </m.div>
    </m.div>,
    document.body
  );
}

// Right-side slide-over drawer — also portaled to <body>.
export function DrawerShell({ onClose, children, maxWidth = "max-w-md", label }: ShellProps) {
  useModalEffects(onClose);
  return createPortal(
    <m.div
      className={`${SCRIM} justify-end`}
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
    >
      <m.div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`flex h-full w-full ${maxWidth} flex-col border-l border-line bg-card shadow-[-20px_0_60px_-15px_rgba(11,16,32,0.3)]`}
        onClick={(e) => e.stopPropagation()}
        initial={{ x: 48, opacity: 0.6 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 420, damping: 40 }}
      >
        {children}
      </m.div>
    </m.div>,
    document.body
  );
}
