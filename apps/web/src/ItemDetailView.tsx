import { useState, type RefObject } from "react";
import type {
  Course,
  Item,
  ItemAssociation,
  RawCapture,
} from "@daymark/domain";
import { useI18n } from "./i18n/index.js";
import { SelectField } from "./SelectField.js";

interface Props {
  item: Item;
  courses: Course[];
  rawCapture: RawCapture | null;
  associations: { association: ItemAssociation; item: Item }[];
  associationCandidates: Item[];
  headingId: string;
  confirmDelete: boolean;
  editButtonRef: RefObject<HTMLButtonElement | null>;
  deleteButtonRef: RefObject<HTMLButtonElement | null>;
  confirmDeleteButtonRef: RefObject<HTMLButtonElement | null>;
  onEdit(): void;
  onComplete(item: Item): void;
  onRestore(item: Item): void;
  onDelete(item: Item): void;
  onRequestDelete(): void;
  onCancelDelete(): void;
  onAssociate(itemId: string): Promise<void>;
  onRemoveAssociation(associationId: string): Promise<void>;
}

const dateTimeOptions: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

export function ItemDetailView({
  item,
  courses,
  rawCapture,
  associations,
  associationCandidates,
  headingId,
  confirmDelete,
  editButtonRef,
  deleteButtonRef,
  confirmDeleteButtonRef,
  onEdit,
  onComplete,
  onRestore,
  onDelete,
  onRequestDelete,
  onCancelDelete,
  onAssociate,
  onRemoveAssociation,
}: Props) {
  const { t, formatDateTime } = useI18n();
  const [showRaw, setShowRaw] = useState(false);
  const [associationId, setAssociationId] = useState("");
  const course = courses.find((value) => value.id === item.course_id);
  const hasTime = Boolean(
    item.start_at ||
    item.start_date ||
    item.occurrence_start_at ||
    item.occurrence_start_date ||
    item.occurrence_end_at ||
    item.occurrence_end_date ||
    item.due_at ||
    item.due_date,
  );
  const notesId = `${headingId}-notes`;
  const deleteId = `${headingId}-delete`;
  const reminderLabels: Record<Item["reminder_level"], string> = {
    OFF: t("item.reminderOff"),
    NORMAL: t("item.reminderNormal"),
    HIGH: t("item.reminderHigh"),
  };
  const stamp = (value: string) => formatDateTime(value, dateTimeOptions);

  return (
    <>
      <header className="detail-heading">
        <p className="eyebrow">
          {item.status === "COMPLETE" ? "COMPLETED" : "OPEN ITEM"}
        </p>
        <h2 id={headingId}>{item.title}</h2>
      </header>
      <dl className="detail-facts">
        <div>
          <dt>{t("item.courseLabel")}</dt>
          <dd>{course?.name ?? t("item.noCourse")}</dd>
        </div>
        <div>
          <dt>{t("item.statusLabel")}</dt>
          <dd className={`detail-status ${item.status.toLowerCase()}`}>
            <span aria-hidden="true">
              {item.status === "COMPLETE" ? "✓" : "○"}
            </span>
            {item.status === "COMPLETE"
              ? t("item.completed")
              : t("item.incomplete")}
          </dd>
        </div>
        {!hasTime && (
          <div>
            <dt>{t("item.timeLabel")}</dt>
            <dd>{t("item.noTime")}</dd>
          </div>
        )}
        {(item.start_at || item.start_date) && (
          <div>
            <dt>{t("item.start")}</dt>
            <dd>{stamp(item.start_date || item.start_at!)}</dd>
          </div>
        )}
        {(item.occurrence_start_at || item.occurrence_start_date) && (
          <div>
            <dt>{t("item.occur")}</dt>
            <dd>
              {item.occurrence_end_at || item.occurrence_end_date
                ? t("item.tagRange", {
                    start: stamp(
                      item.occurrence_start_date || item.occurrence_start_at!,
                    ),
                    end: stamp(
                      item.occurrence_end_date || item.occurrence_end_at!,
                    ),
                  })
                : stamp(
                    item.occurrence_start_date || item.occurrence_start_at!,
                  )}
            </dd>
          </div>
        )}
        {!item.occurrence_start_at &&
          !item.occurrence_start_date &&
          (item.occurrence_end_at || item.occurrence_end_date) && (
            <div>
              <dt>{t("item.occurEnd")}</dt>
              <dd>
                {stamp(item.occurrence_end_date || item.occurrence_end_at!)}
              </dd>
            </div>
          )}
        {(item.due_at || item.due_date) && (
          <div>
            <dt>{t("item.due")}</dt>
            <dd>{stamp(item.due_date || item.due_at!)}</dd>
          </div>
        )}
        <div>
          <dt>{t("item.reminder")}</dt>
          <dd>{reminderLabels[item.reminder_level]}</dd>
        </div>
      </dl>
      {item.detail && (
        <section className="detail-notes" aria-labelledby={notesId}>
          <h3 id={notesId}>{t("item.detailField")}</h3>
          <p className="detail-content">{item.detail}</p>
        </section>
      )}
      <section
        className="item-associations"
        aria-label={t("item.associations")}
      >
        <h3>{t("item.associations")}</h3>
        {associations.length ? (
          <ul>
            {associations.map((value) => (
              <li key={value.association.id}>
                <span>{value.item.title}</span>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void onRemoveAssociation(value.association.id)}
                >
                  {t("item.removeAssociation")}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="detail-meta">{t("item.noAssociations")}</p>
        )}
        {associationCandidates.length > 0 && (
          <div className="association-add">
            <SelectField
              value={associationId}
              onChange={setAssociationId}
              ariaLabel={t("item.selectAssociation")}
              label={t("item.selectAssociation")}
              options={[
                { value: "", label: t("item.chooseItem") },
                ...associationCandidates.map((candidate) => ({
                  value: candidate.id,
                  label: candidate.title,
                })),
              ]}
            />
            <button
              className="quiet-button"
              type="button"
              disabled={!associationId}
              onClick={() => {
                const target = associationId;
                setAssociationId("");
                void onAssociate(target);
              }}
            >
              {t("item.addAssociation")}
            </button>
          </div>
        )}
      </section>
      <div className="detail-actions">
        {item.status === "INCOMPLETE" ? (
          <button type="button" onClick={() => onComplete(item)}>
            {t("item.completeItem")}
          </button>
        ) : (
          <button type="button" onClick={() => onRestore(item)}>
            {t("item.restoreItem")}
          </button>
        )}
        <button
          ref={editButtonRef}
          type="button"
          className="quiet-button"
          onClick={onEdit}
        >
          {t("item.edit")}
        </button>
      </div>
      {rawCapture && (
        <div className="raw-capture">
          <button
            type="button"
            className="text-button"
            aria-expanded={showRaw}
            onClick={() => setShowRaw(!showRaw)}
          >
            {t("item.rawRecords")}
            <svg
              className={`raw-toggle-glyph${showRaw ? " open" : ""}`}
              viewBox="0 0 24 24"
              width="13"
              height="13"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {showRaw && <p>{rawCapture.raw_text}</p>}
        </div>
      )}
      <div className="danger-zone">
        {!confirmDelete ? (
          <button
            ref={deleteButtonRef}
            type="button"
            className="text-button danger"
            onClick={onRequestDelete}
          >
            {t("item.deleteItem")}
          </button>
        ) : (
          <div
            className="delete-confirmation"
            role="alertdialog"
            aria-labelledby={deleteId}
          >
            <p id={deleteId}>
              {t("item.deleteConfirmTitle", { title: item.title })}
            </p>
            <small>{t("item.deleteConfirmBody")}</small>
            <div className="delete-confirmation-actions">
              <button
                ref={confirmDeleteButtonRef}
                type="button"
                className="confirm-delete-button"
                onClick={() => onDelete(item)}
              >
                {t("item.confirmDelete")}
              </button>
              <button
                type="button"
                className="quiet-button"
                onClick={onCancelDelete}
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
