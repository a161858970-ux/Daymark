import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installBackButton } from "./backButton.js";

/**
 * The suite runs in a node environment (this repo has no jsdom — component
 * tests use renderToStaticMarkup), so the module's browser globals are
 * supplied as tiny fakes: enough to exercise the real selector/visibility/
 * Escape logic without new dependencies.
 */

type OverlayState = { display?: string; opacity?: string; rects: boolean };

let overlays: Record<string, OverlayState[]> = {};
let dispatched: { key: string }[] = [];

class FakeElement {
  constructor(readonly state: OverlayState) {}
  getClientRects(): unknown[] {
    return this.state.rects ? [{}] : [];
  }
}

function installFakes() {
  class FakeKeyboardEvent {
    constructor(_type: string, init: { key: string }) {
      Object.assign(this, init);
    }
  }
  Object.assign(globalThis, {
    window: {
      dispatchEvent: (event: { key: string }) => {
        dispatched.push(event);
        return true;
      },
    },
    document: {
      querySelectorAll: (selector: string) =>
        (overlays[selector] ?? []).map((state) => new FakeElement(state)),
    },
    getComputedStyle: (element: FakeElement) => ({
      display: element.state.display ?? "block",
      visibility: "visible",
      opacity: element.state.opacity ?? "1",
    }),
    KeyboardEvent: FakeKeyboardEvent,
  });
}

beforeEach(() => {
  overlays = {};
  dispatched = [];
  installFakes();
});

afterEach(() => {
  for (const key of [
    "window",
    "document",
    "getComputedStyle",
    "KeyboardEvent",
  ]) {
    delete (globalThis as Record<string, unknown>)[key];
  }
});

describe("installBackButton", () => {
  it("is not consumed on the root page (shell minimises the app)", () => {
    installBackButton();
    expect(window.__daymarkBack?.()).toBe(false);
    expect(dispatched).toHaveLength(0);
  });

  it("consumes the press when an overlay is open and dispatches Escape", () => {
    overlays[".detail-panel"] = [{ rects: true }];
    installBackButton();
    expect(window.__daymarkBack?.()).toBe(true);
    expect(dispatched).toEqual([{ key: "Escape" }]);
  });

  it("treats display:none or transparent overlays as closed", () => {
    overlays[".account-popover"] = [{ display: "none", rects: true }];
    installBackButton();
    expect(window.__daymarkBack?.()).toBe(false);

    overlays[".search-surface"] = [{ opacity: "0", rects: true }];
    expect(window.__daymarkBack?.()).toBe(false);
  });

  it("treats overlays without layout (rects empty) as closed", () => {
    overlays[".select-panel"] = [{ rects: false }];
    installBackButton();
    expect(window.__daymarkBack?.()).toBe(false);
  });
});
