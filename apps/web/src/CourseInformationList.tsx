import { useState, type FormEvent } from "react";
import type { CourseInformation } from "@course-manager/domain";

interface Props {
  information: CourseInformation[];
  onAdd(content: string): Promise<void>;
  onEdit(id: string, content: string): Promise<void>;
  onDelete(id: string): Promise<void>;
}

export function CourseInformationList({
  information,
  onAdd,
  onEdit,
  onDelete,
}: Props) {
  const [content, setContent] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");

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
    <section className="course-information" aria-label="课程信息">
      <div className="subsection-header">
        <div>
          <h2>课程信息</h2>
          <p>长期有效的课堂要求、老师说明与课程上下文。</p>
        </div>
        <button
          type="button"
          className="secondary-action"
          aria-expanded={adding}
          onClick={() => setAdding(!adding)}
        >
          {adding ? "收起" : "＋ 添加课程信息"}
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
            placeholder="记录关于这门课的信息……"
            aria-label="新增课程信息"
            autoFocus
          />
          <button type="submit">保存信息</button>
        </form>
      )}
      {information.length === 0 && (
        <p className="empty-state">还没有课程信息。</p>
      )}
      <ul className="information-list">
        {information.map((entry) => (
          <li key={entry.id}>
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
                  aria-label="编辑课程信息"
                  required
                />
                <button type="submit">保存</button>
                <button
                  type="button"
                  className="quiet-button"
                  onClick={() => setEditingId(null)}
                >
                  取消
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
                    编辑
                  </button>
                  <button
                    type="button"
                    className="text-button danger"
                    onClick={() => void onDelete(entry.id)}
                  >
                    删除
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
