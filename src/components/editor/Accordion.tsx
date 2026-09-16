import { useState, type ReactNode } from "react";
import { motion, AnimatePresence, type Easing } from "motion/react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Accordion — a controlled or uncontrolled collapsible section.
 *
 * Animation rules (Emil Kowalski / motion polish):
 *   - height: animated to "auto" with a strong custom ease-out
 *   - opacity: shorter fade paired with the height
 *   - chevron: rotates 90° on toggle (transform, GPU only)
 *   - prefers-reduced-motion: drop the transform on the chevron; let
 *     the browser's reduce-motion guard freeze the height transition.
 */

// motion/react's Easing type accepts a cubic-bezier tuple, not a string.
const EASE_OUT: Easing = [0.23, 1, 0.32, 1];

interface AccordionProps {
  title: string;
  children: ReactNode;
  /** Initial open state when uncontrolled. Default: true */
  defaultOpen?: boolean;
  /** Controlled open state */
  open?: boolean;
  /** Called when the user toggles */
  onOpenChange?: (open: boolean) => void;
  /** Optional class for the outer wrapper */
  className?: string;
  /** Optional class for the inner content wrapper */
  contentClassName?: string;
  /** Hide the chevron entirely */
  hideChevron?: boolean;
  /** Tiny label rendered next to the title (e.g. a count or status) */
  hint?: ReactNode;
}

export function Accordion({
  title,
  children,
  defaultOpen = true,
  open: controlledOpen,
  onOpenChange,
  className,
  contentClassName,
  hideChevron = false,
  hint,
}: AccordionProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;

  const toggle = () => {
    const next = !open;
    if (isControlled) onOpenChange?.(next);
    else setInternalOpen(next);
  };

  return (
    <div className={cn("border-b border-foreground/[0.06] last:border-b-0", className)}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="group flex w-full items-center justify-between py-3 cursor-pointer min-w-0"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="text-[13px] font-semibold text-foreground tracking-tight truncate min-w-0">
            {title}
          </span>
          {hint && (
            <span className="text-[11px] font-medium text-muted-foreground tabular-nums">
              {hint}
            </span>
          )}
        </span>
        {!hideChevron && (
          <motion.span
            animate={{ rotate: open ? 0 : -90 }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
            className="text-muted-foreground group-hover:text-foreground transition-colors"
          >
            <ChevronDown className="size-3.5" aria-hidden="true" />
          </motion.span>
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              height: { duration: 0.28, ease: EASE_OUT },
              opacity: { duration: 0.2, ease: "easeOut" },
            }}
            style={{ overflow: "hidden" }}
          >
            <div className={cn("pb-4 space-y-4", contentClassName)}>
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
