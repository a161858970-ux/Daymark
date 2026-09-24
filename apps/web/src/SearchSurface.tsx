import { useEffect, useMemo, useRef, useState } from "react";
import {
  searchCourseManagerRecords,
  type Course,
  type CourseInformation,
  type CourseManagerSearchResults,
  type Item,
} from "@course-manager/domain";
import { motionDuration, useExitTransition } from "./motion.js";

export function SearchGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="5.75" />
      <path d="m15 15 4.5 4.5" />
    </svg>
  );
}

export function GlobalSearchButton({
  onOpen,
  className = "search-shortcut",
  label = "搜索",
}: {
  onOpen(): void;
  className?: string;
  label?: string;
}) {
  return (
    <button type="button" className={className} onClick={onOpen}>
      <span className="search-trigger-glyph">
        <SearchGlyph />
      </span>
      <span>{label}</span>
    </button>
  );
}

export function SearchResultGroups({
  results,
  courses,
  onOpenItem,
  onOpenCourse,
  onOpenInformation,
}: {
  results: CourseManagerSearchResults;
  courses: Course[];
  onOpenItem(item: Item): void;
  onOpenCourse(course: Course): void;
  onOpenInformation(entry: CourseInformation): void;
}) {
  const courseById = new Map(courses.map((course) => [course.id, course]));
  return (
    <div className="search-result-groups">
      {results.items.length > 0 && (
        <section aria-labelledby="search-items-heading">
          <h2 id="search-items-heading">事项</h2>
          <ul>
            {results.items.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => onOpenItem(item)}>
                  <span
                    className={`search-result-mark ${item.status === "COMPLETE" ? "complete" : ""}`}
                    aria-hidden="true"
                  >
                    {item.status === "COMPLETE" ? "✓" : "○"}
                  </span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>
                      {item.course_id
                        ? (courseById.get(item.course_id)?.name ?? "课程已移除")
                        : "无课程"}
                      {item.status === "COMPLETE" ? " · 已完成" : ""}
                    </small>
                  </span>
                  <span className="search-result-arrow" aria-hidden="true">
                    →
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {results.courses.length > 0 && (
        <section aria-labelledby="search-courses-heading">
          <h2 id="search-courses-heading">课程</h2>
          <ul>
            {results.courses.map((course) => (
              <li key={course.id}>
                <button type="button" onClick={() => onOpenCourse(course)}>
                  <span className="search-result-mark" aria-hidden="true">
                    ◇
                  </span>
                  <span>
                    <strong>{course.name}</strong>
                    <small>{course.instructor ?? "未记录教师"}</small>
                  </span>
                  <span className="search-result-arrow" aria-hidden="true">
                    →
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {results.courseInformation.length > 0 && (
        <section aria-labelledby="search-information-heading">
          <h2 id="search-information-heading">课程信息</h2>
          <ul>
            {results.courseInformation.map((entry) => (
              <li key={entry.id}>
                <button type="button" onClick={() => onOpenInformation(entry)}>
                  <span className="search-result-mark" aria-hidden="true">
                    •
                  </span>
                  <span>
                    <strong>{entry.content}</strong>
                    <small>
                      {courseById.get(entry.course_id)?.name ?? "课程已移除"}
                    </small>
                  </span>
                  <span className="search-result-arrow" aria-hidden="true">
                    →
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function SearchSurface({
  items,
  courses,
  courseInformation,
  onClose,
  onOpenItem,
  onOpenCourse,
  onOpenInformation,
}: {
  items: Item[];
  courses: Course[];
  courseInformation: CourseInformation[];
  onClose(): void;
  onOpenItem(item: Item): void;
  onOpenCourse(course: Course): void;
  onOpenInformation(entry: CourseInformation): void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef(true);
  const { exiting, beginExit } = useExitTransition(
    onClose,
    motionDuration.short,
  );
  const results = useMemo(
    () =>
      searchCourseManagerRecords(query, { items, courses, courseInformation }),
    [courseInformation, courses, items, query],
  );
  const resultCount =
    results.items.length +
    results.courses.length +
    results.courseInformation.length;

  function close(restoreFocus: boolean) {
    restoreFocusRef.current = restoreFocus;
    beginExit();
  }

  function choose(action: () => void) {
    restoreFocusRef.current = false;
    action();
  }

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    inputRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (restoreFocusRef.current) previousFocusRef.current?.focus();
    };
  }, []);

  return (
    <div
      className={`search-backdrop ${exiting ? "closing" : ""}`}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close(true);
      }}
    >
      <section
        ref={panelRef}
        className="search-surface"
        role="dialog"
        aria-modal="true"
        aria-labelledby="global-search-heading"
      >
        <header>
          <div>
            <p className="eyebrow">GLOBAL SEARCH</p>
            <h1 id="global-search-heading">搜索记录</h1>
          </div>
          <button
            type="button"
            className="detail-close"
            aria-label="关闭搜索"
            onClick={() => close(true)}
          >
            ×
          </button>
        </header>
        <label className="search-input">
          <span className="search-trigger-glyph" aria-hidden="true">
            <SearchGlyph />
          </span>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索事项、课程或课程信息"
            aria-label="搜索事项、课程或课程信息"
          />
          {query && (
            <button
              type="button"
              aria-label="清空搜索"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
            >
              清除
            </button>
          )}
        </label>
        <p className="search-summary" aria-live="polite">
          {query.trim()
            ? resultCount
              ? `找到 ${resultCount} 条匹配记录`
              : "没有匹配的记录"
            : "输入关键词，直接定位本机已有记录。"}
        </p>
        {query.trim() && resultCount > 0 ? (
          <SearchResultGroups
            results={results}
            courses={courses}
            onOpenItem={(item) => choose(() => onOpenItem(item))}
            onOpenCourse={(course) => choose(() => onOpenCourse(course))}
            onOpenInformation={(entry) =>
              choose(() => onOpenInformation(entry))
            }
          />
        ) : (
          <div className="search-empty" aria-hidden="true">
            <span>{query.trim() ? "○" : "⌕"}</span>
          </div>
        )}
      </section>
    </div>
  );
}
