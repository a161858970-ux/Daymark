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

/** Pixels a desktop notch is worth (Chrome/Edge report 100 per notch). */
export const NOTCH_PX = 100;

/**
 * Wheel delta → notches. One notch is one row, so precision is kept; a long
 * spin simply accumulates many notches, so distance is kept too. Deltas are
 * kept as a remainder instead of being dropped, so fast scrolling never
 * loses input.
 */
export function notchDelta(deltaY: number, deltaMode: number): number {
  if (deltaMode === 1) return deltaY / 3; // lines: a notch is 3 lines
  if (deltaMode === 2) return deltaY; // pages: 100px per page-step
  return deltaY / NOTCH_PX;
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
  /** Resting row, and the row a running glide is heading for. */
  const indexRef = useRef(0);
  const pendingRef = useRef<number | null>(null);
  const fallbackRef = useRef(0);
  const [centerIndex, setCenterIndex] = useState(() =>
    centerIndexFor(value, count),
  );

  // Land on the value on mount (no animation); this runs once per opening.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const index = centerIndexFor(value, count);
    viewport.scrollTop = index * ITEM_HEIGHT;
    indexRef.current = index;
    pendingRef.current = null;
    setCenterIndex(index);
    lastValueRef.current = value;
    // The wheel is re-created whenever the panel opens; later value changes
    // are handled by the effect below.
  }, []);

  // A mouse notch is ~100px, three rows of 34px, which used to jump over
  // values (2 → 5) and made whole hours unreachable. The gesture is
  // therefore normalised: one wheel step = exactly one row, deltas from the
  // same notch are swallowed during a short lock.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    let acc = 0;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      // Whole notches only; the fraction stays queued so nothing is lost
      // between events (this is what made fast spins fall behind).
      acc += notchDelta(event.deltaY, event.deltaMode);
      const steps = Math.trunc(acc);
      if (steps === 0) return;
      acc -= steps;
      // Chain from the running glide so fast notches keep moving forward.
      const base = pendingRef.current ?? indexRef.current;
      const next = base + steps;
      pendingRef.current = next;
      indexRef.current = next;
      // Snap would fight a programmatic glide; it is restored on landing.
      viewport.style.scrollSnapType = "none";
      viewport.scrollTo({ top: next * ITEM_HEIGHT, behavior: "smooth" });
      window.clearTimeout(fallbackRef.current);
      fallbackRef.current = window.setTimeout(() => {
        if (pendingRef.current === next) {
          pendingRef.current = null;
          viewport.style.scrollSnapType = "";
        }
      }, 400);
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      viewport.removeEventListener("wheel", onWheel);
      window.clearTimeout(fallbackRef.current);
    };
  }, []);

  // An external change (e.g. the 现在 preset) re-centres the wheel.
  useEffect(() => {
    if (value === lastValueRef.current) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const index = centerIndexFor(value, count);
    viewport.scrollTop = index * ITEM_HEIGHT;
    indexRef.current = index;
    pendingRef.current = null;
    lastValueRef.current = value;
    setCenterIndex(index);
  }, [value, count]);

  function settle() {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const row = viewport.scrollTop / ITEM_HEIGHT;
    const pending = pendingRef.current;
    let index = Math.round(row);
    if (pending !== null) {
      // A glide is running: follow the visual centre row by row, but never
      // re-centre or wrap — that would cancel the animation.
      if (Math.abs(row - pending) < 0.06) {
        pendingRef.current = null;
        viewport.style.scrollSnapType = "";
        index = pending;
        // A long spin can land on an extreme row; jump a whole cycle there
        // so the chain keeps a safe runway for the next notch.
        const total = REPEATS * count;
        if (index < count) index += count;
        else if (index >= total - count) index -= count;
        if (index !== pending) viewport.scrollTop = index * ITEM_HEIGHT;
      }
    } else {
      // External scroll (touch, keyboard, snap settling): keep the loop
      // seamless by jumping a whole cycle inside the middle repeats.
      const total = REPEATS * count;
      if (index < count) index += count;
      else if (index >= total - count) index -= count;
      if (index !== Math.round(row)) viewport.scrollTop = index * ITEM_HEIGHT;
    }
    indexRef.current = index;
    const wrapped = valueFromIndex(index, count);
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
