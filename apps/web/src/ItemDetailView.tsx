import { useState, type RefObject } from "react";
import type {
  Course,
  Item,
  ItemAssociation,
  RawCapture,
} from "@daymark/domain";
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

const reminderLabels: Record<Item["reminder_level"], string> = {
  OFF: "关闭",
  NORMAL: "普通",
  HIGH: "高",
};

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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
  const [showRaw, setShowRaw] = useState(false);
  const [associationId, setAssociationId] = useState("");
  const course = courses.find((value) => value.id === item.course_id);
  const hasTime = Boolean(
    item.start_at ||
    item.occurrence_start_at ||
    item.occurrence_end_at ||
    item.due_at,
  );
  const notesId = `${headingId}-notes`;
  const deleteId = `${headingId}-delete`;

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
          <dt>课程</dt>
          <dd>{course?.name ?? "无课程"}</dd>
        </div>
        <div>
          <dt>状态</dt>
          <dd className={`detail-status ${item.status.toLowerCase()}`}>
            <span aria-hidden="true">
              {item.status === "COMPLETE" ? "✓" : "○"}
            </span>
            {item.status === "COMPLETE" ? "已完成" : "未完成"}
          </dd>
        </div>
        {!hasTime && (
          <div>
            <dt>时间</dt>
            <dd>未定</dd>
          </div>
        )}
        {item.start_at && (
          <div>
            <dt>开始</dt>
            <dd>{formatDateTime(item.start_at)}</dd>
          </div>
        )}
        {item.occurrence_start_at && (
          <div>
            <dt>发生</dt>
            <dd>
              {formatDateTime(item.occurrence_start_at)}
              {item.occurrence_end_at
                ? ` — ${formatDateTime(item.occurrence_end_at)}`
                : ""}
            </dd>
          </div>
        )}
        {!item.occurrence_start_at && item.occurrence_end_at && (
          <div>
            <dt>发生结束</dt>
            <dd>{formatDateTime(item.occurrence_end_at)}</dd>
          </div>
        )}
        {item.due_at && (
          <div>
            <dt>截止</dt>
            <dd>{formatDateTime(item.due_at)}</dd>
          </div>
        )}
        <div>
          <dt>提醒</dt>
          <dd>{reminderLabels[item.reminder_level]}</dd>
        </div>
      </dl>
      {item.detail && (
        <section className="detail-notes" aria-labelledby={notesId}>
          <h3 id={notesId}>补充内容</h3>
          <p className="detail-content">{item.detail}</p>
        </section>
      )}
      <section className="item-associations" aria-label="关联事项">
        <h3>关联事项</h3>
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
                  移除关联
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="detail-meta">暂无关联事项</p>
        )}
        {associationCandidates.length > 0 && (
          <div className="association-add">
            <SelectField
              value={associationId}
              onChange={setAssociationId}
              ariaLabel="选择关联事项"
              label="选择关联事项"
              options={[
                { value: "", label: "选择事项…" },
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
              添加关联
            </button>
          </div>
        )}
      </section>
      <div className="detail-actions">
        {item.status === "INCOMPLETE" ? (
          <button type="button" onClick={() => onComplete(item)}>
            <span aria-hidden="true">✓</span> 完成事项
          </button>
        ) : (
          <button type="button" onClick={() => onRestore(item)}>
            恢复为未完成
          </button>
        )}
        <button
          ref={editButtonRef}
          type="button"
          className="quiet-button"
          onClick={onEdit}
        >
          编辑
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
            原始记录
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
            删除事项
          </button>
        ) : (
          <div
            className="delete-confirmation"
            role="alertdialog"
            aria-labelledby={deleteId}
          >
            <p id={deleteId}>删除“{item.title}”？</p>
            <small>删除后会提供一次短暂撤销。</small>
            <div className="delete-confirmation-actions">
              <button
                ref={confirmDeleteButtonRef}
                type="button"
                className="confirm-delete-button"
                onClick={() => onDelete(item)}
              >
                确认删除
              </button>
              <button
                type="button"
                className="quiet-button"
                onClick={onCancelDelete}
              >
                取消
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
