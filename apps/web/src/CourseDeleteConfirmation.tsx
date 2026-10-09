import { useState } from "react";
import type { Course, Item } from "@daymark/domain";
import { useT } from "./i18n/index.js";
import { toUserMessage } from "./errors.js";

type Strategy = "DELETE_ASSOCIATED_ITEMS" | "UNLINK_ASSOCIATED_ITEMS";

interface Props {
  course: Course;
  items: Item[];
  onCancel(): void;
  onConfirm(strategy: Strategy): Promise<void>;
}

export function CourseDeleteConfirmation({
  course,
  items,
  onCancel,
  onConfirm,
}: Props) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm(strategy: Strategy) {
    setBusy(true);
    try {
      await onConfirm(strategy);
      setError(null);
    } catch (cause) {
      setError(toUserMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="course-delete-confirmation"
      aria-label={t("course.deleteConfirmTitle")}
    >
      <h2>{t("course.deleteCourseTitle", { name: course.name })}</h2>
      <p>{t("course.deleteLinkedItems", { count: items.length })}</p>
      {items.length > 0 && (
        <ul>
          {items.map((item) => (
            <li key={item.id}>{item.title}</li>
          ))}
        </ul>
      )}
      <div className="course-delete-actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => void confirm("UNLINK_ASSOCIATED_ITEMS")}
        >
          {t("course.deleteKeepTasks")}
        </button>
        <button
          type="button"
          disabled={busy}
          className="danger"
          onClick={() => void confirm("DELETE_ASSOCIATED_ITEMS")}
        >
          {t("course.deleteWithTasks")}
        </button>
        <button
          type="button"
          disabled={busy}
          className="quiet-button"
          onClick={onCancel}
        >
          {t("common.cancel")}
        </button>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
