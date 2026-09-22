import { useEffect, useRef, useState, type FormEvent } from "react";

export function QuickCapture({
  onSave,
}: {
  onSave: (text: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (expanded) input.current?.focus();
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node))
        setExpanded(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [expanded]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || saving) return;
    setSaving(true);
    try {
      await onSave(text);
      setText("");
      input.current?.focus();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      ref={container}
      className={`quick-capture ${expanded ? "expanded" : ""}`}
    >
      <form onSubmit={(event) => void submit(event)}>
        {expanded && (
          <input
            ref={input}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="记录一件事……"
            aria-label="快速记录"
          />
        )}
        <button
          type={expanded ? "submit" : "button"}
          disabled={saving}
          aria-label={expanded ? "保存记录" : "打开快速记录"}
          onClick={() => {
            if (!expanded) setExpanded(true);
          }}
        >
          {expanded ? "→" : "+"}
        </button>
      </form>
    </div>
  );
}
