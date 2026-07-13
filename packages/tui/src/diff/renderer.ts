/**
 * Renderer — orchestrates layout, paint, and diff to produce ANSI output.
 *
 * The renderer is a factory function ({@link createRenderer}) that returns a
 * closure over a {@link LogUpdate} instance and a prev-screen reference
 * (double buffering). Each call to the returned renderer:
 *   1. Sizes the root Yoga node to the terminal dimensions.
 *   2. Calculates the layout tree.
 *   3. Allocates a fresh {@link Screen} for the new frame.
 *   4. Paints the DOM tree into an {@link Output} backed by that screen.
 *   5. Diffs the new frame against the previous one via {@link LogUpdate}.
 *      On the first call `prev` is `null` (full repaint); thereafter the
 *      retained prev screen enables incremental diff.
 *   6. Clears the dirty flag on every node.
 *   7. Retains the new screen as `prev` for the next call.
 *
 * The returned string is wrapped in synchronized-output guards (CSI 2026)
 * by {@link LogUpdate.render} and is ready to write to the terminal.
 *
 * The {@link LogUpdate} instance and prev screen are retained across calls,
 * so successive frames produce incremental diffs rather than full repaints
 * (until the terminal dimensions change, which triggers a full repaint).
 *
 * P1 scope: BSU/ESU wrapping, damage region merging, DECSTBM scroll hint,
 * full SGR via styleCache. The whole tree is still re-laid-out and
 * re-painted every frame; only the diff output is incremental.
 *
 * Reference: src/ink/renderer.ts (full version).
 */

import type { TuiElement } from "../dom/tree.ts";
import type { HighlightBuilder } from "../highlight.ts";
import { Output } from "../output/output.ts";
import { renderNode } from "../output/render-node.ts";
import { Screen } from "../screen/screen.ts";
import { LogUpdate } from "./log-update.ts";

// --
// Public API

/**
 * Render a single frame of `rootNode` to an ANSI string.
 *
 * `terminalWidth` / `terminalHeight` are the terminal dimensions in
 * columns / rows. The renderer sizes the root node to these dimensions,
 * so the caller must not pre-size the root — any prior width/height on
 * the root is overwritten.
 *
 * `highlightBuilder`, when provided, is called with the freshly painted
 * screen before the diff pass. It returns a {@link HighlightPredicate}
 * (or `undefined` to skip highlighting) that controls which cells receive
 * inverse styling for text selection / search highlight.
 */
export type Renderer = (
	rootNode: TuiElement,
	terminalWidth: number,
	terminalHeight: number,
	highlightBuilder?: HighlightBuilder,
) => string;

/**
 * Create a renderer. The returned function retains a {@link LogUpdate}
 * instance and a prev {@link Screen} reference across calls (double
 * buffering), so successive calls produce incremental diffs rather than
 * full repaints. Construct one renderer per TUI session and reuse it for
 * the lifetime of that session.
 */
export function createRenderer(): Renderer {
	const logUpdate = new LogUpdate();
	let prevScreen: Screen | null = null;
	return (
		rootNode: TuiElement,
		terminalWidth: number,
		terminalHeight: number,
		highlightBuilder?: HighlightBuilder,
	): string => {
		// 1. Size the root to the terminal. Yoga reads these as fixed
		//    dimensions (width/height mode = EXACTLY) for the root; children
		//    resolve their sizes against this.
		rootNode.yogaNode.setWidth(terminalWidth);
		rootNode.yogaNode.setHeight(terminalHeight);

		// 1b. Legacy `ink-legacy` nodes are opaque to the new engine: their
		//     internal state (a Container's `children` array, an Editor's
		//     buffer, a streaming AssistantMessage's content) can change
		//     without any DOM/Yoga mutation reaching the bridge. Yoga
		//     caches measured heights and skips re-measure for clean
		//     (!isDirty_) nodes, so without re-marking legacy wrappers dirty
		//     before each layout pass, newly-added chat messages or tool
		//     calls would be rendered by `renderLegacy` but clipped to the
		//     stale cached height — invisible on screen. This mirrors the
		//     legacy TUI's behavior of re-rendering every component each
		//     frame; native (ink-box/ink-text) subtree dirty tracking is
		//     left intact.
		markLegacyNodesDirty(rootNode);

		// 2. Calculate layout. Walks the whole Yoga tree and computes
		//    left/top/width/height for every node.
		rootNode.yogaNode.calculateLayout();

		// 3. Allocate the new frame buffer. A fresh screen every frame
		//    avoids carrying stale cells from the previous frame; the diff
		//    pass is what keeps the emitted bytes small.
		const newScreen = new Screen(terminalWidth, terminalHeight);

		// 4. Paint the DOM tree into the Output backed by newScreen.
		//    renderNode walks the tree in document order, queueing fill and
		//    write operations; flush applies them to the Screen.
		//
		//    Legacy bridge layout fix: wrapped components are measured at
		//    their natural height (flexShrink: 0). When the stacked total
		//    exceeds the terminal height, Yoga simply clips the overflow
		//    at the bottom, hiding the newest messages and the editor's
		//    bottom border. The legacy TUI instead keeps the bottom of the
		//    output visible and pushes the oldest lines into scrollback.
		//    Reproduce that by painting the tree with a negative root Y
		//    offset so the last `terminalHeight` rows land in the viewport.
		const overflowOffset = computeLegacyOverflowOffset(rootNode, terminalHeight);
		const output = new Output(newScreen);
		renderNode(rootNode, output, -overflowOffset);
		output.flush();

		// 5. Diff against the previous frame. On the first call prevScreen
		//    is null (full repaint); thereafter only changed cells are
		//    emitted. The LogUpdate API takes (prev, cur) so the caller
		//    manages the double-buffering. When a highlightBuilder is
		//    provided, it is called with the freshly painted screen to
		//    obtain the highlight predicate (or undefined to skip); this
		//    mutates cells with inverse styling before the diff pass so
		//    highlight changes are detected as style changes.
		//
		//    P5 Task 32.3: when no highlight predicate is active, collect
		//    the yoga rects of dirty subtree roots (nodes marked by
		//    {@link markDirty} via {@link TuiElement.dirtySubtreeRoot}) and
		//    pass their merged y-spans as `dirtyYRanges` so the diff scans
		//    only those rows. When a highlight is active the hint is
		//    dropped (highlight changes may affect cells outside any dirty
		//    subtree — e.g. search-highlight matches in a non-dirty region),
		//    and the diff falls back to scanning all rows with the row-hash
		//    fast path skipping unchanged rows.
		const predicate = highlightBuilder !== undefined ? highlightBuilder(newScreen) : undefined;
		const dirtyYRanges = predicate === undefined ? collectDirtyYRanges(rootNode, terminalHeight) : undefined;
		const ansi = logUpdate.render(prevScreen, newScreen, predicate, dirtyYRanges);

		// 6. Retain the new screen as prev for the next call.
		prevScreen = newScreen;

		// 7. Clear dirty flags so the next mutation re-marks only the
		//    affected subtree (markDirty stops at the first already-dirty
		//    ancestor, so leaving flags set would make markDirty no-ops).
		clearDirty(rootNode);

		return ansi;
	};
}

// --
// Dirty y-range collection (P5 Task 32.3)

/**
 * Walk `rootNode` depth-first and collect the computed yoga rects of
 * every node with {@link TuiElement.dirtySubtreeRoot} set. Returns the
 * rects as merged half-open `[start, end)` y-intervals clamped to
 * `[0, terminalHeight)`, or `undefined` when no dirty subtree roots
 * exist (the diff then falls back to scanning all rows and the
 * row-hash fast path skips unchanged rows).
 *
 * Each node's absolute Y is computed by accumulating
 * `getComputedTop()` along the parent chain — yoga returns positions
 * relative to the parent, so summing from the root down yields the
 * absolute screen row. The walk maintains a running `absY` per stack
 * entry so the traversal stays O(N) rather than O(N × depth).
 *
 * Overlapping or adjacent ranges are merged by {@link mergeYRanges}
 * so the diff pass does not scan the same row twice.
 *
 * Scroll-box safety: if a dirty subtree root is a DESCENDANT of an
 * `ink-scroll-box` (not the scroll box itself), the node's layout
 * rect does not match its painted screen position — the scroll box
 * paints through a temporary screen with a `scrollTop` offset, so a
 * child at layout Y=5 inside a scroll box at screen Y=20 with
 * scrollTop=3 is painted at screen Y=22, not Y=25. Using the layout
 * rect would scan the wrong rows and miss the actual changes. When
 * this case is detected, the function returns `undefined` (scan all
 * rows) as a safe fallback. When the scroll box ITSELF is the dirty
 * subtree root (e.g. `appendChild` to it), its rect is collected
 * normally — the scroll box's rect covers its visible area, which is
 * where the painted content lands on screen.
 */
function collectDirtyYRanges(
	rootNode: TuiElement,
	terminalHeight: number,
): ReadonlyArray<readonly [number, number]> | undefined {
	const ranges: Array<[number, number]> = [];
	// Stack of [node, absY] pairs. absY is the absolute screen row of
	// the node's border-box origin (sum of getComputedTop from the
	// root down to this node).
	const stack: Array<[TuiElement, number]> = [[rootNode, 0]];
	while (stack.length > 0) {
		const [node, absY] = stack.pop() as [TuiElement, number];
		if (node.dirtySubtreeRoot) {
			// Scroll-box safety: if any ancestor is a scroll box, the
			// node's layout rect doesn't match its screen position.
			// Fall back to scanning all rows to ensure correctness.
			let ancestor: TuiElement | undefined = node.parentNode;
			while (ancestor !== undefined) {
				if (ancestor.nodeName === "ink-scroll-box") {
					return undefined;
				}
				ancestor = ancestor.parentNode;
			}
			const height = node.yogaNode.getComputedHeight();
			const yStart = Math.max(0, absY);
			const yEnd = Math.min(terminalHeight, absY + height);
			if (yEnd > yStart) {
				ranges.push([yStart, yEnd]);
			}
		}
		for (const child of node.childNodes) {
			// getComputedTop is relative to the parent, so the child's
			// absolute Y is the parent's absY plus the child's top offset.
			stack.push([child, absY + child.yogaNode.getComputedTop()]);
		}
	}
	if (ranges.length === 0) return undefined;
	return mergeYRanges(ranges);
}

/**
 * Merge overlapping or adjacent `[start, end)` y-intervals into a
 * minimal sorted list. E.g. `[[0,5), [3,8), [10,15)]` becomes
 * `[[0,8), [10,15)]`. Returns an empty array when the input is empty.
 *
 * Sorting is by `start` ascending; the merge then extends the last
 * emitted range when the next range's start is `<=` the current end
 * (overlap or adjacency).
 */
function mergeYRanges(ranges: Array<[number, number]>): Array<readonly [number, number]> {
	if (ranges.length === 0) return [];
	// Sort by start ascending so we can merge in a single pass.
	ranges.sort((a, b) => a[0] - b[0]);
	const merged: Array<[number, number]> = [[ranges[0][0], ranges[0][1]]];
	for (let i = 1; i < ranges.length; i++) {
		const [start, end] = ranges[i];
		const last = merged[merged.length - 1];
		if (start <= last[1]) {
			// Overlap or adjacency — extend the last range.
			if (end > last[1]) last[1] = end;
		} else {
			merged.push([start, end]);
		}
	}
	return merged;
}

// --
// Dirty flag clearing

/**
 * Reset `node.dirty` and `node.dirtySubtreeRoot` to false and recurse
 * into all descendants. Called after a render pass so that subsequent
 * mutations re-mark only the affected subtrees via {@link markDirty}
 * (which walks up until it hits an already-dirty ancestor).
 *
 * Also clears {@link TuiElement.dirtySubtreeRoot} so the next render
 * pass starts with a clean dirty-region map (P5 Task 32.3).
 *
 * This is the counterpart to `markDirty` in `../dom/tree.ts`, kept here
 * rather than in tree.ts because it is only invoked by the renderer after a
 * completed paint pass.
 */
function clearDirty(node: TuiElement): void {
	node.dirty = false;
	node.dirtySubtreeRoot = false;
	for (const child of node.childNodes) {
		clearDirty(child);
	}
}

// --
// Legacy measure cache invalidation

/**
 * Walk `node`'s subtree depth-first and call `markDirty()` on every
 * `ink-legacy` wrapper. Legacy components are opaque to the new engine —
 * their internal state (e.g. a Container's `children` array, an Editor's
 * buffer, a streaming AssistantMessage's content) can change without any
 * DOM/Yoga mutation reaching the bridge. Yoga caches measured heights
 * and skips re-measure for clean (`!isDirty_`) nodes, so without this
 * pass, newly-added chat messages or tool calls would be rendered by
 * `renderLegacy` but clipped to the stale cached height — invisible on
 * screen.
 *
 * Called once per render pass, just before `calculateLayout()`. The walk
 * is O(N) where N is the total node count, and `markDirty` short-circuits
 * at the first already-dirty ancestor, so the per-frame cost is bounded
 * by the number of legacy wrappers (typically small: one per top-level
 * interactive-mode section). Native `ink-box`/`ink-text` subtrees keep
 * their own dirty tracking intact — only `ink-legacy` nodes are forced
 * dirty here.
 *
 * Note: this means legacy wrappers are always re-measured every frame.
 * This is intentional and matches the legacy TUI's behavior of re-rendering
 * every component each frame; the alternative — exposing a bridge-level
 * "dirty" hook on every Component — would require migrating every legacy
 * component, defeating the bridge's purpose.
 */
function markLegacyNodesDirty(node: TuiElement): void {
	if (node.nodeName === "ink-legacy") {
		node.yogaNode.markDirty();
		// Still descend: a legacy wrapper has no children in the new DOM
		// model, but the walk is harmless and keeps the helper generic.
	}
	for (const child of node.childNodes) {
		markLegacyNodesDirty(child);
	}
}

// --
// Legacy overflow scrollback emulation

/**
 * Compute how many rows the painted frame must be shifted down so that
 * the bottom of the legacy layout stays visible.
 *
 * Legacy components wrapped by the new engine are measured at their
 * natural height. With `flexShrink: 0` on every wrapper, Yoga lays the
 * sections out from the top and simply clips anything that extends past
 * the root's fixed height. The legacy TUI instead writes every line to
 * the terminal and lets the terminal show the last `terminalHeight`
 * rows (scrollback). To match that behavior in the new engine, we shift
 * the painted screen down by the overflow amount.
 *
 * Only non-absolute root children participate: absolute-positioned
 * overlays are positioned relative to the viewport and must not be
 * scrolled.
 *
 * Returns 0 when everything fits or when there are no participating
 * children.
 */
export function computeLegacyOverflowOffset(rootNode: TuiElement, terminalHeight: number): number {
	let maxBottom = 0;
	for (const child of rootNode.childNodes) {
		// Skip absolute-positioned overlays; they are anchored to the
		// viewport, not the flow.
		if (child.style.position === "absolute") continue;
		const top = Math.round(child.yogaNode.getComputedTop());
		const height = Math.round(child.yogaNode.getComputedHeight());
		maxBottom = Math.max(maxBottom, top + height);
	}
	return Math.max(0, maxBottom - terminalHeight);
}
