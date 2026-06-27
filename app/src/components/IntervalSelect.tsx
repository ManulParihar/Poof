import { useEffect, useId, useRef, useState } from "react";
import { INTERVALS } from "../lib/schedule";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-4 w-4 text-poof-muted transition-transform duration-200 ${open ? "rotate-180 text-poof-gold" : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** A golden, dark-themed interval picker over the schedule presets.
 *  A custom listbox (instead of a native <select>) so the open menu carries
 *  the app's gold-on-ink aesthetic, matching the Asset picker. */
export default function IntervalSelect({
  value,
  onChange,
  testid,
  dropUp = false,
}: {
  value: number;
  onChange: (sec: number) => void;
  testid?: string;
  /** Open the menu upward — useful when the field sits at the bottom of an
   *  `overflow-hidden` card that would otherwise clip a downward menu. */
  dropUp?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = INTERVALS.find((i) => i.sec === value) ?? INTERVALS[0];

  // Close on outside click or Escape so the menu behaves like a real dropdown.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (sec: number) => {
    onChange(sec);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        data-testid={testid}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        className={`group flex w-full items-center gap-3 rounded-xl border bg-poof-surface px-4 py-3
                    text-left transition outline-none
                    ${open
                      ? "border-poof-gold ring-2 ring-poof-gold/30"
                      : "border-poof-border hover:border-poof-gold/50"}`}
      >
        <span className="flex-1 font-semibold text-poof-text">{selected.label}</span>
        <Chevron open={open} />
      </button>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Select interval"
          className={`absolute z-20 w-full overflow-hidden rounded-xl border border-poof-border
                      bg-poof-card/95 p-1.5 shadow-glow backdrop-blur-xl animate-fade-in
                      ${dropUp ? "bottom-full mb-2" : "mt-2"}`}
        >
          {INTERVALS.map((i) => {
            const active = i.sec === value;
            return (
              <li key={i.id} role="option" aria-selected={active}>
                <button
                  type="button"
                  data-testid={testid ? `${testid}-option-${i.id}` : undefined}
                  onClick={() => pick(i.sec)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition
                              ${active ? "bg-poof-gold/10" : "hover:bg-poof-surface"}`}
                >
                  <span className={`flex-1 font-medium ${active ? "text-poof-gold" : "text-poof-text"}`}>
                    {i.label}
                  </span>
                  {active && (
                    <svg
                      className="h-4 w-4 text-poof-gold"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
