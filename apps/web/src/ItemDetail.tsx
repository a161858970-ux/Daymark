import { useEffect, useId, useRef, useState } from "react";
import type {
  Course,
  Item,
  ItemAssociation,
  RawCapture,
} from "@course-manager/domain";
import { ItemEditForm, type EditableItemFields } from "./ItemEditForm.js";
import { ItemDetailView } from "./ItemDetailView.js";
import { motionDuration, useExitTransition } from "./motion.js";

export type { EditableItemFields } from "./ItemEditForm.js";

interface Props {
  item: Item;
  courses: Course[];
  rawCapture: RawCapture | null;
  associations: { association: ItemAssociation; item: Item }[];
  associationCandidates: Item[];
  onClose(): void;
  onComplete(item: Item): void;
  onRestore(item: Item): void;
  onDelete(item: Item): Promise<boolean>;
  onSave(item: Item, fields: EditableItemFields): Promise<void>;
  onAssociate(itemId: string): Promise<void>;
  onRemoveAssociation(associationId: string): Promise<void>;
}

export function ItemDetail({
  item,
  courses,
  rawCapture,
  associations,
  associationCandidates,
  onClose,
  onComplete,
  onRestore,
  onDelete,
  onSave,
  onAssociate,
  onRemoveAssociation,
}: Props) {
  const headingId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const confirmDeleteButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const currentItemIdRef = useRef(item.id);
  currentItemIdRef.current = item.id;
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [confirmDeleteItemId, setConfirmDeleteItemId] = useState<string | null>(
    null,
  );
  const { exiting, beginExit } = useExitTransition(
    onClose,
    motionDuration.panel,
    item.id,
  );
  const editing = editingItemId === item.id;
  const confirmDelete = confirmDeleteItemId === item.id;

  function cancelEditing() {
    setEditingItemId(null);
    window.requestAnimationFrame(() => editButtonRef.current?.focus());
  }

  function finishEditing() {
    setEditingItemId(null);
    window.requestAnimationFrame(() => editButtonRef.current?.focus());
  }

  function cancelDelete() {
    setConfirmDeleteItemId(null);
    window.requestAnimationFrame(() => deleteButtonRef.current?.focus());
  }

  useEffect(() => {
    setEditingItemId(null);
    setConfirmDeleteItemId(null);
  }, [item.id]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() =>
      closeButtonRef.current?.focus(),
    );
    return () => {
      window.cancelAnimationFrame(frame);
      const previous = previousFocusRef.current;
      const currentRow = document.querySelector<HTMLElement>(
        `[data-item-row-id="${currentItemIdRef.current}"] .item-body`,
      );
      const fallback = document.getElementById("completed-heading");
      const target =
        currentRow && !currentRow.matches(":disabled")
          ? currentRow
          : previous?.isConnected
            ? previous
            : fallback;
      target?.focus();
    };
  }, []);

  useEffect(() => {
    if (!confirmDelete) return;
    const frame = window.requestAnimationFrame(() =>
      confirmDeleteButtonRef.current?.focus(),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [confirmDelete]);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (confirmDelete) {
        cancelDelete();
        return;
      }
      if (editing) {
        cancelEditing();
        return;
      }
      beginExit();
    }
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [beginExit, confirmDelete, editing, item.id]);

  return (
    <>
      <button
        type="button"
        className={`detail-backdrop ${exiting ? "closing" : ""}`}
        aria-label="关闭事项详情"
        tabIndex={-1}
        onClick={beginExit}
      />
      <aside
        ref={panelRef}
        className={`detail-panel ${exiting ? "closing" : ""}`}
        role="dialog"
        aria-labelledby={headingId}
        tabIndex={-1}
      >
        <span className="sheet-handle" aria-hidden="true" />
        <div className="detail-top">
          <span>事项详情</span>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={beginExit}
            aria-label="关闭事项详情"
          >
            ×
          </button>
        </div>
        <div key={item.id} className="detail-object" data-item-id={item.id}>
          {editing ? (
            <ItemEditForm
              item={item}
              courses={courses}
              headingId={headingId}
              onSave={onSave}
              onSaved={finishEditing}
              onCancel={cancelEditing}
            />
          ) : (
            <div className="detail-view">
              <ItemDetailView
                item={item}
                courses={courses}
                rawCapture={rawCapture}
                associations={associations}
                associationCandidates={associationCandidates}
                headingId={headingId}
                confirmDelete={confirmDelete}
                editButtonRef={editButtonRef}
                deleteButtonRef={deleteButtonRef}
                confirmDeleteButtonRef={confirmDeleteButtonRef}
                onEdit={() => setEditingItemId(item.id)}
                onComplete={onComplete}
                onRestore={onRestore}
                onDelete={(deletedItem) => {
                  void onDelete(deletedItem).then((deleted) => {
                    if (deleted) beginExit();
                  });
                }}
                onRequestDelete={() => setConfirmDeleteItemId(item.id)}
                onCancelDelete={cancelDelete}
                onAssociate={onAssociate}
                onRemoveAssociation={onRemoveAssociation}
              />
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
