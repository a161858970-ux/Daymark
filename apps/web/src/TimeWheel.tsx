import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

const ITEM_HEIGHT = 34;
/** Odd, ≥3: wrap jumps by one full cycle so the middle repeats stay safe. */
const REPEATS = 7;

/** Scroll index → selected value, wrapping through the cycle. */
export function valueFromIndex(index: number, count: number): number {
  return ((index % count) + count) % count;
}

/** First index of the middle repeat — the resting place for the wheels. */
export function centerIndexFor(value: number, count: number): number {
  return ((REPEATS - 1) / 2) * count + value;
}

interface Props {
  count: number;
  value: number;
  onChange: (next: number) => void;
  label: string;
  ariaLabel: string;
}

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * Cyclic time wheel: the row sitting on the fixed centre band *is* the
 * current setting — there is no click-to-pick, scrolling is the input.
 * The list repeats so 23→00 (or 59→00) rolls over without an edge, and a
 * re-centring jump lands on an identical copy so the loop looks seamless.
 */
export function TimeWheel({ count, value, onChange, label, ariaLabel }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef(0);
  const lastValueRef = useRef(value);
  const [centerIndex, setCenterIndex] = useState(() =>
    centerIndexFor(value, count),
  );

  // Land on the value on mount (no animation); this runs once per opening.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const index = centerIndexFor(value, count);
    viewport.scrollTop = index * ITEM_HEIGHT;
    setCenterIndex(index);
    lastValueRef.current = value;
    // The wheel is re-created whenever the panel opens; later value changes
    // are handled by the effect below.
  }, []);

  // An external change (e.g. the 现在 preset) re-centres the wheel.
  useEffect(() => {
    if (value === lastValueRef.current) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const index = centerIndexFor(value, count);
    viewport.scrollTop = index * ITEM_HEIGHT;
    lastValueRef.current = value;
    setCenterIndex(index);
  }, [value, count]);

  function settle() {
    const viewport = viewportRef.current;
    if (!viewport) return;
    let index = Math.round(viewport.scrollTop / ITEM_HEIGHT);
    const total = REPEATS * count;
    // Jump by a whole cycle inside the middle repeats: same value, same
    // surrounding rows, so the correction is invisible.
    if (index < count) index += count;
    else if (index >= total - count) index -= count;
    const wrapped = valueFromIndex(index, count);
    if (Math.round(viewport.scrollTop / ITEM_HEIGHT) !== index)
      viewport.scrollTop = index * ITEM_HEIGHT;
    if (wrapped !== lastValueRef.current) {
      lastValueRef.current = wrapped;
      onChange(wrapped);
    }
    setCenterIndex((current) => (current === index ? current : index));
  }

  function handleScroll() {
    if (frameRef.current) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = 0;
      settle();
    });
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const step =
      event.key === "ArrowDown"
        ? ITEM_HEIGHT
        : event.key === "ArrowUp"
          ? -ITEM_HEIGHT
          : event.key === "PageDown"
            ? count * ITEM_HEIGHT
            : event.key === "PageUp"
              ? -count * ITEM_HEIGHT
              : 0;
    if (!step) return;
    event.preventDefault();
    viewport.scrollBy({ top: step, behavior: "smooth" });
  }

  const items = Array.from({ length: REPEATS * count }, (_, index) => ({
    index,
    text: pad(index % count),
  }));

  return (
    <div className="datetime-wheel">
      <p className="datetime-time-label">{label}</p>
      <div className="datetime-wheel-shell">
        <div
          className="datetime-wheel-viewport"
          ref={viewportRef}
          role="spinbutton"
          tabIndex={0}
          aria-label={ariaLabel}
          aria-valuemin={0}
          aria-valuemax={count - 1}
          aria-valuenow={value}
          aria-valuetext={`${label} ${pad(value)}`}
          onScroll={handleScroll}
          onKeyDown={handleKeyDown}
        >
          <div className="datetime-wheel-track">
            {items.map((item) => (
              <div
                key={item.index}
                data-idx={item.index}
                className={
                  item.index === centerIndex
                    ? "datetime-wheel-item is-center"
                    : "datetime-wheel-item"
                }
              >
                {item.text}
              </div>
            ))}
          </div>
        </div>
        <span className="datetime-wheel-band" aria-hidden="true" />
      </div>
    </div>
  );
}
