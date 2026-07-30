"use client";

import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/**
 * Backdrop, entrance animation, escape-to-close and click-outside — the
 * parts every modal needs and none of them should reimplement.
 *
 * Deliberately unopinionated about the body: callers own their own
 * padding and sections, because the two modals using this look nothing
 * alike below the header.
 */
export function ModalShell({
  title,
  icon,
  tone = "default",
  onClose,
  children,
}: {
  title: ReactNode;
  icon?: ReactNode;
  /** `danger` tints the icon well red — for actions that spend real money. */
  tone?: "default" | "danger";
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
      >
        <motion.div
          role="dialog"
          aria-modal="true"
          className="w-full max-w-md overflow-hidden rounded-2xl bg-card"
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.97 }}
          transition={{ duration: 0.25, ease: EASE }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3 px-5 py-4">
            <div className="flex items-start gap-3">
              {icon && (
                <span
                  className={
                    tone === "danger"
                      ? "text-destructive flex size-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10"
                      : "flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary"
                  }
                >
                  {icon}
                </span>
              )}
              <div className="min-w-0">{title}</div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
          {children}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
