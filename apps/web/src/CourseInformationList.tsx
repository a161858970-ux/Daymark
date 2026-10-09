import { useEffect, useRef, useState, type FormEvent } from "react";
import type { CourseInformation } from "@daymark/domain";
import { useT } from "./i18n/index.js";

interface Props {
  information: CourseInformation[];
  onAdd(content: string): Promise<void>;
  onEdit(id: string, content: string): Promise<void>;
  onDelete(id: string): Promise<void>;
  highlightedId?: string | null;
}

export function CourseInformationList({
  information,
  onAdd,
  onEdit,
  onDelete,
  highlightedId = null,
}: Props) {
  const t = useT();
  const [content, setContent] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [highlightPulseId, setHighlightPulseId] = useState<string | null>(null);
  const entryRefs = useRef(new Map<string, HTMLLIElement>());
  const handledHighlightRef = useRef<string | null>(null);
  const highlightTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (highlightTimerRef.current !== null)
        window.clearTimeout(highlightTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!highlightedId) {
      handledHighlightRef.current = null;
      return;
    }
    if (handledHighlightRef.current === highlightedId) return;
    const entry = entryRefs.current.get(highlightedId);
    if (!entry) return;
    handledHighlightRef.current = highlightedId;
    setHighlightPulseId(highlightedId);
    entry.scrollIntoView({ block: "center", behavior: "smooth" });
    entry.focus({ preventScroll: true });
    if (highlightTimerRef.current !== null)
      window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => {
      highlightTimerRef.current = null;
      setHighlightPulseId(null);
    }, 1600);
  }, [highlightedId, information]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!content.trim()) return;
    try {
      await onAdd(content);
      setContent("");
      setAdding(false);
    } catch {
      // The parent presents the storage error; retain the unsaved text.
    }
  }

  return (
    <section
      className="course-information"
      aria-label={t("course.informationSection")}
    >
      <div className="subsection-header">
        <div>
          <h2>{t("course.informationSection")}</h2>
          <p>{t("course.informationDeck")}</p>
        </div>
        <button
          type="button"
          className="secondary-action"
          aria-expanded={adding}
          onClick={() => setAdding(!adding)}
        >
          {adding ? t("common.collapse") : t("course.addInformation")}
        </button>
      </div>
      {adding && (
        <form
          className="course-item-form inline-reveal"
          onSubmit={(event) => void submit(event)}
        >
          <input
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder={t("course.informationPlaceholder")}
            aria-label={t("course.addInformationTitle")}
            autoFocus
          />
          <button type="submit">{t("course.saveInformation")}</button>
        </form>
      )}
      {information.length === 0 && (
        <p className="empty-state">{t("course.emptyInformation")}</p>
      )}
      <ul className="information-list">
        {information.map((entry) => (
          <li
            key={entry.id}
            ref={(node) => {
              if (node) entryRefs.current.set(entry.id, node);
              else entryRefs.current.delete(entry.id);
            }}
            tabIndex={-1}
            data-course-information-id={entry.id}
            className={highlightPulseId === entry.id ? "search-arrival" : ""}
          >
            {editingId === entry.id ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void onEdit(entry.id, editContent)
                    .then(() => setEditingId(null))
                    .catch(() => {
                      /* parent presents the error */
                    });
                }}
              >
                <input
                  value={editContent}
                  onChange={(event) => setEditContent(event.target.value)}
                  aria-label={t("course.editInformation")}
                  required
                />
                <button type="submit">{t("common.save")}</button>
                <button
                  type="button"
                  className="quiet-button"
                  onClick={() => setEditingId(null)}
                >
                  {t("common.cancel")}
                </button>
              </form>
            ) : (
              <>
                <p>{entry.content}</p>
                <div>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setEditingId(entry.id);
                      setEditContent(entry.content);
                    }}
                  >
                    {t("common.edit")}
                  </button>
                  <button
                    type="button"
                    className="text-button danger"
                    onClick={() => void onDelete(entry.id)}
                  >
                    {t("common.delete")}
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
