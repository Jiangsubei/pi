/**
 * ScrollBox factory — Task 23.
 *
 * Creates an `ink-scroll-box` element that virtualizes vertical scrolling:
 * children are painted into a temporary screen and only the
 * `[scrollTop, scrollTop + contentHeight)` slice is blitted to the
 * main screen. The scroll position lives on {@link TuiElement.scrollTop}
 * so the renderer and the scroll API share a single source of truth.
 *
 * API:
 *   - {@link createScrollBox} — factory, returns a {@link ScrollBoxElement}
 *   - {@link ScrollBoxElement.scrollTo} — set scrollTop (clamped to [0, maxScroll])
 *   - {@link ScrollBoxElement.scrollBy} — add a delta to scrollTop
 *   - {@link ScrollBoxElement.scrollToBottom} — jump to the bottom
 *
 * `stickyScroll: true` keeps the bottom visible when children are appended:
 * the renderer sets `scrollTop = maxScroll` whenever `stickToBottom` is set,
 * which the scroll API manages automatically.
 *
 * Reference: Claude Code `ScrollBox.tsx` — Pi replaces React/JSX with a
 * plain-TS factory attaching methods to the {@link TuiElement} instance.
 */

import type { TuiElement } from "../dom/tree.ts";
import { appendChild, createNode, getMaxScroll, markDirty } from "../dom/tree.ts";
import type { Styles } from "../dom/types.ts";

// --
// Engine interface (avoids a circular import of TuiEngine)

/**
 * Minimal engine surface the scroll API needs. {@link TuiEngine} satisfies
 * this structurally, so `engine.createScrollBox` can pass `this` directly.
 */
export interface ScrollBoxEngine {
	requestRender(): void;
}

// --
// ScrollBoxElement

/**
 * A {@link TuiElement} produced by {@link createScrollBox}. The scroll
 * API methods are attached to the instance by the factory so callers can
 * invoke them directly on the returned node.
 */
export interface ScrollBoxElement extends TuiElement {
	/** Set `scrollTop`, clamped to `[0, maxScroll]`. Schedules a render. */
	scrollTo(scrollTop: number): void;
	/** Add `delta` to `scrollTop` (clamped). Schedules a render. */
	scrollBy(delta: number): void;
	/** Jump to the bottom (`scrollTop = maxScroll`). Schedules a render. */
	scrollToBottom(): void;
}

// --
// Factory

/**
 * Create an `ink-scroll-box` element with scroll-container defaults.
 *
 * Defaults merged under the caller's `style`:
 *   - `flexDirection: "column"` — children stack vertically (typical list)
 *   - `overflow: "scroll"` — children do not expand the container; the
 *     renderer applies `scrollTop` translation
 *
 * When `engine` is provided, the scroll API methods call
 * `engine.requestRender()` after mutating `scrollTop` so the next frame
 * reflects the change. Without an engine, callers must trigger a render
 * themselves (e.g. via another mutation).
 *
 * `stickyScroll: true` in `style` enables sticky-to-bottom behavior:
 * the factory initializes `stickToBottom = true` so the first paint
 * shows the bottom of the content, and appending children keeps it
 * visible. Explicit `scrollTo`/`scrollBy` calls that move away from
 * the bottom clear `stickToBottom`; `scrollToBottom` sets it again.
 */
export function createScrollBox(style?: Styles, engine?: ScrollBoxEngine): ScrollBoxElement {
	const mergedStyle: Styles = {
		flexDirection: "column",
		overflow: "scroll",
		...style,
	};

	const node = createNode("ink-scroll-box", mergedStyle) as ScrollBoxElement;
	node.scrollTop = 0;
	node.stickToBottom = mergedStyle.stickyScroll === true;

	const requestRender = (): void => {
		markDirty(node);
		engine?.requestRender();
	};

	node.scrollTo = (scrollTop: number): void => {
		const max = getMaxScroll(node);
		node.scrollTop = Math.max(0, Math.min(scrollTop, max));
		if (node.style.stickyScroll === true) {
			node.stickToBottom = node.scrollTop >= max;
		}
		requestRender();
	};

	node.scrollBy = (delta: number): void => {
		node.scrollTo(node.scrollTop + delta);
	};

	node.scrollToBottom = (): void => {
		const max = getMaxScroll(node);
		node.scrollTop = max;
		if (node.style.stickyScroll === true) {
			node.stickToBottom = true;
		}
		requestRender();
	};

	return node;
}

// --
// Sticky-aware append

/**
 * Append `child` to `parent` with sticky-scroll handling.
 *
 * If `parent` is an `ink-scroll-box` with `stickyScroll: true` and the
 * caller is currently at the bottom (`scrollTop >= maxScroll`), the
 * `stickToBottom` flag is refreshed so the next paint pass keeps the
 * new bottom visible. If the user scrolled away from the bottom,
 * `stickToBottom` is left untouched and the viewport stays put.
 *
 * Use this from engine-side wrappers when you want sticky behavior
 * without the caller having to inspect `style.stickyScroll`. For raw
 * tree mutation, {@link appendChild} in `dom/tree.ts` is sufficient —
 * the renderer reads `stickToBottom` on the next pass regardless.
 */
export function appendChildSticky(parent: TuiElement, child: TuiElement, engine?: ScrollBoxEngine): void {
	if (parent.nodeName === "ink-scroll-box" && parent.style.stickyScroll === true) {
		const max = getMaxScroll(parent);
		if (parent.scrollTop >= max) {
			parent.stickToBottom = true;
		}
	}
	appendChild(parent, child);
	markDirty(parent);
	engine?.requestRender();
}
