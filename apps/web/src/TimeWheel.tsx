import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

const ITEM_HEIGHT = 34;
/** Odd, ≥3: wrap jumps by one full cycle so the middle repeats stay safe. */
const REPEATS = 7;
/** Pixels a desktop notch is worth (Chrome/Edge report 100 per notch). */
export const NOTCH_PX = 100;
/** Portion of the remaining distance covered each frame while gliding. */
const EASE = 0.3;

/** Scroll index → selected value, wrapping through the cycle. */
export function valueFromIndex(index: number, count: number): number {
  return ((index % count) + count) % count;
}

/** First index of the middle repeat — the resting place for the wheels. */
export function centerIndexFor(value: number, count: number): number {
  return ((REPEATS - 1) / 2) * count + value;
}

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
 *
 * Every step moves a **target**, and one rAF loop eases the viewport toward
 * it. Retargeting never restarts the motion, so a fast spin covers its full
 * distance instead of falling behind the way repeated smooth scrollTo calls
 * did (their remainder was then discarded when the animation timed out).
 */
export function TimeWheel({ count, value, onChange, label, ariaLabel }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef(0);
  const targetRef = useRef(0);
  const lastValueRef = useRef(value);
  const [centerIndex, setCenterIndex] = useState(() =>
    centerIndexFor(value, count),
  );

  function applyIndex(index: number) {
    const wrapped = valueFromIndex(index, count);
    if (wrapped !== lastValueRef.current) {
      lastValueRef.current = wrapped;
      onChange(wrapped);
    }
    setCenterIndex((current) => (current === index ? current : index));
  }

  /** Land on an exact row, wrapping a full cycle at the extremes. */
  function land() {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.style.scrollSnapType = "";
    let index = Math.round(viewport.scrollTop / ITEM_HEIGHT);
    const total = REPEATS * count;
    if (index < count) index += count;
    else if (index >= total - count) index -= count;
    if (index * ITEM_HEIGHT !== viewport.scrollTop) {
      viewport.scrollTop = index * ITEM_HEIGHT;
      targetRef.current = index * ITEM_HEIGHT;
    }
    applyIndex(index);
  }

  function animate() {
    const viewport = viewportRef.current;
    if (!viewport) {
      frameRef.current = 0;
      return;
    }
    const diff = targetRef.current - viewport.scrollTop;
    if (Math.abs(diff) < 0.5) {
      viewport.scrollTop = targetRef.current;
      frameRef.current = 0;
      land();
      return;
    }
    viewport.scrollTop += diff * EASE;
    frameRef.current = window.requestAnimationFrame(animate);
  }

  function glide(targetIndex: number) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    targetRef.current = targetIndex * ITEM_HEIGHT;
    viewport.style.scrollSnapType = "none";
    if (frameRef.current) return;
    frameRef.current = window.requestAnimationFrame(animate);
  }

  function cancelGlide() {
    if (frameRef.current) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    }
    const viewport = viewportRef.current;
    if (viewport) viewport.style.scrollSnapType = "";
    targetRef.current = viewport ? viewport.scrollTop : targetRef.current;
  }

  // Land on the value on mount (no animation); this runs once per opening.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const index = centerIndexFor(value, count);
    targetRef.current = index * ITEM_HEIGHT;
    viewport.scrollTop = targetRef.current;
    applyIndex(index);
    // The wheel is re-created whenever the panel opens; later value changes
    // are handled by the effect below.
  }, []);

  // A mouse notch is ~100px, three rows of 34px: the browser's own scroll
  // would jump three values. The gesture is ours instead — notches queue up
  // and each whole notch is one row, with the fraction carried over.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    let acc = 0;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      acc += notchDelta(event.deltaY, event.deltaMode);
      const steps = Math.trunc(acc);
      if (steps === 0) return;
      acc -= steps;
      // Chain from the target (not the viewport) so fast notches keep
      // adding distance instead of waiting for the glide to catch up.
      const base = Math.round(targetRef.current / ITEM_HEIGHT) + steps;
      glide(base);
    };
    // A finger drag belongs to the browser (native scroll + snap).
    const onTouchStart = () => cancelGlide();
    viewport.addEventListener("wheel", onWheel, { passive: false });
    viewport.addEventListener("touchstart", onTouchStart, { passive: true });
    return () => {
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("touchstart", onTouchStart);
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
    };
  }, []);

  // An external change (e.g. the 现在 preset) re-centres the wheel.
  useEffect(() => {
    if (value === lastValueRef.current) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    cancelGlide();
    const index = centerIndexFor(value, count);
    targetRef.current = index * ITEM_HEIGHT;
    viewport.scrollTop = targetRef.current;
    lastValueRef.current = value;
    setCenterIndex(index);
  }, [value, count]);

  // Scroll position drives the visible value: mid-glide the centre row wins,
  // an idle scroll (touch, snap settling) also keeps the loop seamless.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    let queued = 0;
    const onScroll = () => {
      if (queued) return;
      queued = window.requestAnimationFrame(() => {
        queued = 0;
        const row = Math.round(viewport.scrollTop / ITEM_HEIGHT);
        if (frameRef.current) {
          // Glide running: follow what is passing the centre, never jump.
          applyIndex(row);
          return;
        }
        let index = row;
        const total = REPEATS * count;
        if (index < count) index += count;
        else if (index >= total - count) index -= count;
        if (index * ITEM_HEIGHT !== viewport.scrollTop) {
          viewport.scrollTop = index * ITEM_HEIGHT;
        }
        targetRef.current = index * ITEM_HEIGHT;
        applyIndex(index);
      });
    };
    viewport.addEventListener("scroll", onScroll);
    return () => {
      viewport.removeEventListener("scroll", onScroll);
      if (queued) window.cancelAnimationFrame(queued);
    };
  }, [count]);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const current = Math.round(targetRef.current / ITEM_HEIGHT);
    const step =
      event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowUp"
          ? -1
          : event.key === "PageDown"
            ? count
            : event.key === "PageUp"
              ? -count
              : 0;
    if (!step) return;
    event.preventDefault();
    glide(current + step);
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
