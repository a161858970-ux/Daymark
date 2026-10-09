import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { getMessage } from "./i18n/messages/index.js";
import { readStoredLocale } from "./i18n/locale.js";

export interface SelectOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Names the popup; a visible label may live in the caller's <label>. */
  label?: string;
  ariaLabel?: string;
  id?: string;
  placeholder?: string;
  className?: string;
}

/** Label for the current value; unknown values fall back to the placeholder. */
export function selectedLabel(
  options: SelectOption[],
  value: string,
  placeholder = "",
): string {
  return options.find((option) => option.value === value)?.label ?? placeholder;
}

/**
 * In-app dropdown. The native `<select>` popup is rendered by the OS, so no
 * stylesheet can match it to this product -- it always opens as the browser's
 * own list. The panel is portalled to <body> (candidate hosts scroll) and
 * positioned against the trigger, clamped to the viewport, flipping above the
 * field when there is not enough room below.
 *
 * Values stay plain strings, so every caller keeps its own setter contract.
 */
export function SelectField({
  value,
  onChange,
  options,
  label,
  ariaLabel,
  id,
  placeholder,
  className,
}: Props) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const currentLabel = selectedLabel(options, value, placeholder);

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  function openPanel(nextHighlight = selectedIndex) {
    setHighlight(Math.min(Math.max(nextHighlight, 0), options.length - 1));
    setOpen(true);
  }

  const activeIndex = Math.min(highlight, options.length - 1);

  // Focus the highlighted row and pin the panel to its trigger. Re-runs on
  // every highlight move so the keyboard cursor and DOM focus stay together.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    if (!panel || !trigger) return;
    panel
      .querySelector<HTMLButtonElement>(`button[data-index="${activeIndex}"]`)
      ?.focus();
    const rect = trigger.getBoundingClientRect();
    const width = Math.max(rect.width, 160);
    const maxLeft = Math.max(12, window.innerWidth - width - 12);
    const left = Math.max(12, Math.min(rect.left, maxLeft));
    const spaceBelow = window.innerHeight - 12 - rect.bottom;
    const spaceAbove = rect.top - 12;
    const flip = spaceBelow < 160 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(
      140,
      Math.min(flip ? spaceAbove : spaceBelow, 320),
    );
    const measured = panel.offsetHeight || 200;
    const top = flip
      ? Math.max(12, rect.top - 6 - Math.min(measured, maxHeight))
      : rect.bottom + 6;
    panel.style.width = `${width}px`;
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.maxHeight = `${maxHeight}px`;
    panel.dataset.positioned = "true";
  }, [open, activeIndex]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: Event) => {
      const target = event.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function choose(option: SelectOption) {
    onChange(option.value);
    close(true);
  }

  function onPanelKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const last = options.length - 1;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((index) => Math.min(index + 1, last));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((index) => Math.max(index - 1, 0));
    } else if (event.key === "Home") {
      event.preventDefault();
      setHighlight(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setHighlight(last);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const option = options[Math.min(highlight, last)];
      if (option) choose(option);
    }
  }

  return (
    <span
      className={`select-wrap${className ? ` ${className}` : ""}`}
      ref={wrapRef}
    >
      <button
        type="button"
        ref={triggerRef}
        id={id}
        className={`select-field${value ? "" : " is-empty"}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close() : openPanel())}
        onKeyDown={(event) => {
          // Enter/Space already activate the button natively (one click →
          // one toggle); handling them here would open then immediately
          // close the panel.
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) openPanel();
          }
        }}
      >
        <span className="select-value">{currentLabel}</span>
        <span className="select-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              className="select-panel"
              role="listbox"
              aria-label={
                label ??
                ariaLabel ??
                getMessage(readStoredLocale(), "common.select")
              }
              ref={panelRef}
              tabIndex={-1}
              onKeyDown={onPanelKeyDown}
            >
              {options.map((option, index) => (
                <button
                  type="button"
                  key={option.value || "__empty__"}
                  role="option"
                  data-index={index}
                  aria-selected={option.value === value}
                  data-active={index === activeIndex || undefined}
                  onFocus={() => setHighlight(index)}
                  onClick={() => choose(option)}
                >
                  {option.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
