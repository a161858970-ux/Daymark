import { useState } from "react";
import type { Course, Item } from "@course-manager/domain";

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm(strategy: Strategy) {
    setBusy(true);
    try {
      await onConfirm(strategy);
      setError(null);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="course-delete-confirmation" aria-label="删除课程确认">
      <h2>删除“{course.name}”</h2>
      <p>这门课程关联 {items.length} 条事项。请选择这些事项的处理方式：</p>
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
          删除课程，保留无课程事项
        </button>
        <button
          type="button"
          disabled={busy}
          className="danger"
          onClick={() => void confirm("DELETE_ASSOCIATED_ITEMS")}
        >
          删除课程及以上事项
        </button>
        <button
          type="button"
          disabled={busy}
          className="quiet-button"
          onClick={onCancel}
        >
          取消
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
