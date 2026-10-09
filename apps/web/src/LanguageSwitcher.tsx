import { useEffect, useId, useRef, useState } from "react";
import { LOCALES, LOCALE_LABELS, useI18n, type Locale } from "./i18n/index.js";
import { motionDuration, useExitTransition } from "./motion.js";

function LanguagesIcon() {
  // Classic "文 / A" translation mark (Wen & A).
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <text
        x="2.2"
        y="16.2"
        fill="currentColor"
        stroke="none"
        fontSize="12.5"
        fontWeight="650"
        fontFamily="ui-serif, 'Songti SC', 'SimSun', serif"
      >
        文
      </text>
      <text
        x="12.8"
        y="16.2"
        fill="currentColor"
        stroke="none"
        fontSize="12.5"
        fontWeight="650"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        A
      </text>
    </svg>
  );
}

/**
 * Global language switcher. Desktop mounts it in the left-nav utility area;
 * mobile mounts the same control beside the account pill (top-right).
 * Locale is a local UI preference — switching never touches business state.
 */
export function LanguageSwitcher({
  variant = "nav",
}: {
  variant?: "nav" | "compact";
}) {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const restoreFocusAfterCloseRef = useRef(false);
  const { exiting, beginExit, cancelExit } = useExitTransition(
    () => {
      setOpen(false);
      if (restoreFocusAfterCloseRef.current) buttonRef.current?.focus();
    },
    motionDuration.short,
    open ? "open" : "closed",
  );

  function closeMenu(restoreFocus: boolean) {
    restoreFocusAfterCloseRef.current = restoreFocus;
    if (!open) return;
    if (exiting) return;
    beginExit();
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) closeMenu(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeMenu(true);
      }
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, exiting]);

  function choose(next: Locale) {
    cancelExit();
    setLocale(next);
    closeMenu(true);
  }

  return (
    <div
      className={`language-switcher language-switcher-${variant}`}
      ref={rootRef}
    >
      <button
        type="button"
        ref={buttonRef}
        className="language-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t("nav.languageTooltip")}
        title={t("nav.languageTooltip")}
        onClick={() => {
          if (open) closeMenu(true);
          else {
            cancelExit();
            setOpen(true);
          }
        }}
      >
        <span className="nav-glyph">
          <LanguagesIcon />
        </span>
        {variant === "nav" ? (
          <span className="nav-label">{t("nav.language")}</span>
        ) : null}
      </button>
      {open || exiting ? (
        <div
          id={menuId}
          role="menu"
          aria-label={t("nav.languageMenu")}
          className={`language-menu ${exiting ? "closing" : ""}`}
        >
          {LOCALES.map((option) => {
            const selected = option === locale;
            return (
              <button
                key={option}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={selected ? "selected" : ""}
                onClick={() => choose(option)}
              >
                <span className="language-option-label">
                  {LOCALE_LABELS[option]}
                </span>
                <span className="language-option-check" aria-hidden="true">
                  {selected ? "✓" : ""}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
