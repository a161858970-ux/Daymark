import { getMessage } from "./i18n/messages/index.js";
import { readStoredLocale } from "./i18n/locale.js";

export type AttentionTone = "ambiguity" | "conflict" | "repair";

export function AttentionSummary({
  eyebrow,
  title,
  description,
  count,
  expanded,
  tone,
  onToggle,
}: {
  eyebrow: string;
  title: string;
  description: string;
  count: number;
  expanded: boolean;
  tone: AttentionTone;
  onToggle(): void;
}) {
  return (
    <button
      type="button"
      className={`attention-summary tone-${tone}`}
      aria-expanded={expanded}
      onClick={onToggle}
    >
      <span className="attention-indicator" aria-hidden="true" />
      <span className="attention-copy">
        <span className="eyebrow">{eyebrow}</span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <span
        className="attention-count"
        aria-label={getMessage(readStoredLocale(), "common.countRecords", {
          count,
        })}
      >
        {count}
      </span>
      <span className="attention-chevron" aria-hidden="true">
        {expanded ? "−" : "+"}
      </span>
    </button>
  );
}
