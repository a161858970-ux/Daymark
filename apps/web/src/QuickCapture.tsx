import { useEffect, useRef, useState, type FormEvent } from "react";
import { useT } from "./i18n/index.js";
import { motionDuration } from "./motion.js";

type SaveState = "IDLE" | "SAVING" | "SAVED" | "ERROR";

export function QuickCapture({
  onSave,
}: {
  onSave: (text: string) => Promise<void>;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState("");
  const [lastSavedText, setLastSavedText] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("IDLE");
  const container = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (expanded) input.current?.focus();
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) {
        setExpanded(false);
        setSaveState("IDLE");
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setExpanded(false);
      setSaveState("IDLE");
      window.requestAnimationFrame(() => button.current?.focus());
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [expanded]);

  useEffect(() => {
    if (saveState !== "SAVED") return;
    const timeout = window.setTimeout(
      () => setSaveState("IDLE"),
      motionDuration.feedback,
    );
    return () => window.clearTimeout(timeout);
  }, [saveState]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!expanded) {
      setExpanded(true);
      return;
    }
    if (!text.trim() || saveState === "SAVING") return;
    setSaveState("SAVING");
    try {
      await onSave(text);
      setLastSavedText(text.trim());
      setText("");
      setSaveState("SAVED");
      input.current?.focus();
    } catch {
      setSaveState("ERROR");
      input.current?.focus();
    }
  }

  const buttonLabel = !expanded
    ? t("capture.open")
    : saveState === "SAVING"
      ? t("capture.saving")
      : saveState === "SAVED"
        ? t("capture.saved")
        : saveState === "ERROR"
          ? t("capture.retrySave")
          : t("capture.save");

  return (
    <div
      ref={container}
      className={`quick-capture ${expanded ? "expanded" : ""} ${saveState.toLowerCase()}`}
    >
      <form
        aria-label={t("capture.title")}
        aria-busy={saveState === "SAVING"}
        onSubmit={(event) => void submit(event)}
      >
        <span className="quick-capture-field">
          <input
            ref={input}
            value={text}
            tabIndex={expanded ? 0 : -1}
            disabled={!expanded}
            aria-hidden={!expanded}
            onChange={(event) => {
              setText(event.target.value);
              if (saveState === "ERROR" || saveState === "SAVED")
                setSaveState("IDLE");
            }}
            placeholder={t("capture.placeholder")}
            aria-label={t("capture.label")}
          />
        </span>
        <button
          ref={button}
          type="submit"
          disabled={
            expanded &&
            (saveState === "SAVING" || saveState === "SAVED" || !text.trim())
          }
          aria-label={buttonLabel}
          aria-expanded={expanded}
        >
          <span className="capture-idle-symbol" aria-hidden="true" />
          <span className="capture-submit-symbol" aria-hidden="true">
            {saveState === "SAVING" ? "…" : saveState === "SAVED" ? "✓" : "→"}
          </span>
        </button>
      </form>
      <span className="quick-capture-feedback" aria-hidden="true">
        <strong>{t("capture.toast")}</strong>
        <span>{lastSavedText}</span>
      </span>
      <span className="sr-only" aria-live="polite">
        {saveState === "SAVED"
          ? t("capture.ariaSaved")
          : saveState === "ERROR"
            ? t("capture.ariaFailed")
            : ""}
      </span>
    </div>
  );
}
