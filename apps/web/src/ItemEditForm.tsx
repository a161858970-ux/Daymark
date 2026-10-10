import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Course, Item } from "@daymark/domain";
import { useI18n } from "./i18n/index.js";
import { changedItemFields } from "./itemEditDiff.js";
import { SelectField } from "./SelectField.js";
import { TimeBlock } from "./TimeBlock.js";
import {
  fromDateOnly,
  fromLocalInput,
  toDateOnly,
  toLocalInput,
} from "./timeInputs.js";

export type EditableItemFields = Partial<
  Pick<
    Item,
    | "title"
    | "detail"
    | "course_id"
    | "start_at"
    | "start_date"
    | "occurrence_start_at"
    | "occurrence_start_date"
    | "occurrence_end_at"
    | "occurrence_end_date"
    | "due_at"
    | "due_date"
    | "time_zone"
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
  const [startDate, setStartDate] = useState(toDateOnly(item.start_date));
  const [occurrenceStartAt, setOccurrenceStartAt] = useState(
    toLocalInput(item.occurrence_start_at),
  );
  const [occurrenceStartDate, setOccurrenceStartDate] = useState(
    toDateOnly(item.occurrence_start_date),
  );
  const [occurrenceEndAt, setOccurrenceEndAt] = useState(
    toLocalInput(item.occurrence_end_at),
  );
  const [occurrenceEndDate, setOccurrenceEndDate] = useState(
    toDateOnly(item.occurrence_end_date),
  );
  const [dueAt, setDueAt] = useState(toLocalInput(item.due_at));
  const [dueDate, setDueDate] = useState(toDateOnly(item.due_date));
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
      start_date: fromDateOnly(startDate),
      occurrence_start_at: fromLocalInput(occurrenceStartAt),
      occurrence_start_date: fromDateOnly(occurrenceStartDate),
      occurrence_end_at: fromLocalInput(occurrenceEndAt),
      occurrence_end_date: fromDateOnly(occurrenceEndDate),
      due_at: fromLocalInput(dueAt),
      due_date: fromDateOnly(dueDate),
      time_zone: item.time_zone,
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
            startDate,
            occurrenceStartAt,
            occurrenceStartDate,
            occurrenceEndAt,
            occurrenceEndDate,
            dueAt,
            dueDate,
          }}
          onChange={(next) => {
            setStartAt(next.startAt);
            setStartDate(next.startDate);
            setOccurrenceStartAt(next.occurrenceStartAt);
            setOccurrenceStartDate(next.occurrenceStartDate);
            setOccurrenceEndAt(next.occurrenceEndAt);
            setOccurrenceEndDate(next.occurrenceEndDate);
            setDueAt(next.dueAt);
            setDueDate(next.dueDate);
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
