import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Course, Item } from "@daymark/domain";
import { useI18n } from "./i18n/index.js";
import { changedItemFields } from "./itemEditDiff.js";
import { SelectField } from "./SelectField.js";
import { TimeBlock } from "./TimeBlock.js";
import { fromLocalInput, toLocalInput } from "./timeInputs.js";

export type EditableItemFields = Partial<
  Pick<
    Item,
    | "title"
    | "detail"
    | "course_id"
    | "start_at"
    | "occurrence_start_at"
    | "occurrence_end_at"
    | "due_at"
    | "reminder_level"
  >
>;

interface Props {
  item: Item;
  courses: Course[];
  headingId: string;
  onSave(item: Item, fields: EditableItemFields): Promise<void>;
  onSaved(): void;
  onCancel(): void;
}

export function ItemEditForm({
  item,
  courses,
  headingId,
  onSave,
  onSaved,
  onCancel,
}: Props) {
  const t = useI18n().t;
  const titleInputRef = useRef<HTMLInputElement>(null);
  // The row can change underneath (another device synced) while this form is
  // open; dirty state is therefore measured against the item as opened.
  const initialRef = useRef(item);
  const [title, setTitle] = useState(item.title);
  const [detail, setDetail] = useState(item.detail ?? "");
  const [courseId, setCourseId] = useState(item.course_id ?? "");
  const [startAt, setStartAt] = useState(toLocalInput(item.start_at));
  const [occurrenceStartAt, setOccurrenceStartAt] = useState(
    toLocalInput(item.occurrence_start_at),
  );
  const [occurrenceEndAt, setOccurrenceEndAt] = useState(
    toLocalInput(item.occurrence_end_at),
  );
  const [dueAt, setDueAt] = useState(toLocalInput(item.due_at));
  const [reminderLevel, setReminderLevel] = useState<Item["reminder_level"]>(
    item.reminder_level,
  );

  useEffect(() => {
    const frame = window.requestAnimationFrame(() =>
      titleInputRef.current?.focus(),
    );
    return () => window.cancelAnimationFrame(frame);
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    const fields = changedItemFields(initialRef.current, {
      title: title.trim(),
      detail: detail.trim() || null,
      course_id: courseId || null,
      start_at: fromLocalInput(startAt),
      occurrence_start_at: fromLocalInput(occurrenceStartAt),
      occurrence_end_at: fromLocalInput(occurrenceEndAt),
      due_at: fromLocalInput(dueAt),
      reminder_level: reminderLevel,
    });
    if (Object.keys(fields).length === 0) {
      onSaved();
      return;
    }
    try {
      await onSave(item, fields);
      onSaved();
    } catch {
      /* parent presents the error; keep form open */
    }
  }

  return (
    <form
      className="detail-form"
      aria-label={t("item.editAria", { title: item.title })}
      onSubmit={(event) => void save(event)}
    >
      <div className="detail-mode-heading">
        <p className="eyebrow">EDIT ITEM</p>
        <h2 id={headingId}>{t("item.editTitle")}</h2>
        <p>{t("item.editDeck")}</p>
      </div>
      <div className="detail-form-grid">
        <label className="detail-field-wide">
          {t("item.titleLabel")}
          <input
            ref={titleInputRef}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
        </label>
        <label>
          {t("item.courseLabel")}
          <SelectField
            value={courseId}
            onChange={setCourseId}
            label={t("item.courseLabel")}
            options={[
              { value: "", label: t("item.noCourse") },
              ...courses.map((course) => ({
                value: course.id,
                label: course.name,
              })),
            ]}
          />
        </label>
        <label>
          {t("item.reminderLevel")}
          <SelectField
            value={reminderLevel}
            onChange={(next) =>
              setReminderLevel(next as Item["reminder_level"])
            }
            label={t("item.reminderLevel")}
            options={[
              { value: "OFF", label: t("item.reminderOff") },
              { value: "NORMAL", label: t("item.reminderNormal") },
              { value: "HIGH", label: t("item.reminderHigh") },
            ]}
          />
        </label>
        <TimeBlock
          value={{
            startAt,
            occurrenceStartAt,
            occurrenceEndAt,
            dueAt,
          }}
          onChange={(next) => {
            setStartAt(next.startAt);
            setOccurrenceStartAt(next.occurrenceStartAt);
            setOccurrenceEndAt(next.occurrenceEndAt);
            setDueAt(next.dueAt);
          }}
        />
        <label className="detail-field-wide">
          {t("item.detailField")}
          <textarea
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
          />
        </label>
      </div>
      <div className="detail-actions detail-edit-actions">
        <button type="submit">{t("item.saveChanges")}</button>
        <button type="button" className="quiet-button" onClick={onCancel}>
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}
