/**
 * Paint pass — recursively render a {@link TuiElement} subtree to an
 * {@link Output}.
 *
 * The renderer walks the DOM tree in document order. For each node it:
 *   1. Reads the Yoga-computed layout (`left`, `top`, `width`, `height`,
 *      `padding`, `border`).
 *   2. Skips the subtree if the node is `display: none` or has zero area.
 *   3. Merges the node's {@link TextStyles} fields (color, bold, italic,
 *      …) with the inherited style from ancestors.
 *   4. Paints an opaque/background fill if `opaque` or
 *      `backgroundColor` is set.
 *   5. Paints a border if `borderStyle` is set (via {@link renderBorder}).
 *   6. Computes the content box (node box minus border and padding).
 *   7. Dispatches by `nodeName`:
 *        - `ink-text`: squash text segments, wrap/truncate to the
 *          content width, and write each line.
 *        - `ink-virtual-text`: skipped (rendered by the parent's squash).
 *        - `ink-link` / `ink-box` / `ink-root`: recurse into children.
 *        - `ink-legacy`: delegate to the bridge's {@link renderLegacy},
 *          which calls the wrapped Component's render(width) and writes
 *          the resulting lines (ANSI stripped, CURSOR_MARKER position
 *          recorded on node.legacyCursor).
 *
 * Yoga returns positions relative to the parent's content box, so the
 * renderer tracks an `(offsetX, offsetY)` accumulator that is the sum
 * of all ancestor `left`/`top` values. The root is expected to be laid
 * out at `(0, 0)`.
 *
 * P1 scope (this file):
 *   - Border rendering via {@link renderBorder}.
 *   - Text squash via {@link squashText} (style inheritance through
 *     nested `ink-text` / `ink-virtual-text`).
 *   - Text wrap / truncate via {@link wrapText}.
 *   - Full {@link TextStyles} propagation (not just fg/bg flags).
 *   - `opaque` fill support.
 *
 * Reference: Claude Code `src/ink/render-node-to-output.ts` (full
 * version).
 */

import { renderLegacy } from "../bridge/render.ts";
import { clearNodeCache, setNodeRect } from "../dom/node-cache.ts";
import type { TuiElement } from "../dom/tree.ts";
import { getMaxScroll } from "../dom/tree.ts";
import type { Styles, TextStyles } from "../dom/types.ts";
import { LayoutDisplay, LayoutEdge } from "../layout/node.ts";
import { Screen } from "../screen/screen.ts";
import { visibleWidth } from "../utils.ts";
import { Output } from "./output.ts";
import { renderBorder } from "./render-border.ts";
import { squashText } from "./squash-text.ts";
import { wrapText } from "./wrap-text.ts";

// --
// Scroll drain — per-frame consumption of pendingScrollDelta

/**
 * Minimum rows applied per frame for native terminal drain. Above this,
 * drain is proportional (~3/4 of remaining) so big bursts catch up in
 * log₄ frames while the tail decelerates smoothly.
 */
const SCROLL_MIN_PER_FRAME = 4;

/**
 * Deltas at or below this threshold are applied instantly in a single
 * frame. Avoids splitting small scrolls (single wheel tick, page down)
 * across multiple frames. Adapted from Claude Code's
 * `SCROLL_INSTANT_THRESHOLD`.
 */
const SCROLL_INSTANT_THRESHOLD = 5;

/**
 * Drain pendingScrollDelta using a proportional strategy: deltas ≤
 * SCROLL_INSTANT_THRESHOLD are applied instantly; larger deltas use
 * step = max(MIN, floor(abs*3/4)), capped at innerHeight-1. Remaining
 * delta stays in pendingScrollDelta for the next frame. Adapted from
 * Claude Code's `drainProportional` + `drainAdaptive`.
 */
function drainProportional(node: TuiElement, pending: number, innerHeight: number): number {
	const abs = Math.abs(pending);
	if (abs <= SCROLL_INSTANT_THRESHOLD) {
		node.pendingScrollDelta = undefined;
		return pending;
	}
	const cap = Math.max(1, innerHeight - 1);
	const step = Math.min(cap, Math.max(SCROLL_MIN_PER_FRAME, (abs * 3) >> 2));
	if (abs <= step) {
		node.pendingScrollDelta = undefined;
		return pending;
	}
	const applied = pending > 0 ? step : -step;
	node.pendingScrollDelta = pending - applied;
	return applied;
}

/**
 * Set of scroll-box nodes that still have pendingScrollDelta after this
 * frame's drain. The engine checks this after render and schedules another
 * frame if non-empty so the drain continues.
 */
const scrollDrainNodes: Set<TuiElement> = new Set();

/**
 * Consume and return whether any scroll-box has remaining pending delta.
 * The engine calls this after render to decide whether to schedule
 * another frame.
 */
export function hasPendingScrollDrain(): boolean {
	return scrollDrainNodes.size > 0;
}

// --
// Public API

/**
 * Render `node` and its descendants to `output`. Call after Yoga layout
 * has been computed (i.e. `node.yogaNode.calculateLayout()` has been
 * invoked on the root). The root's own `(left, top)` is assumed to be
 * `(0, 0)`.
 *
 * Operations are queued on `output`; the caller is responsible for
 * calling `output.flush()` to apply them to the underlying Screen.
 *
 * The public signature `renderNode(node, output)` is preserved for
 * backward compatibility with the renderer (`diff/renderer.ts`).
 */
export function renderNode(node: TuiElement, output: Output, rootOffsetY: number = 0): void {
	scrollDrainNodes.clear();
	clearNodeCache();
	renderNodeInternal(node, output, {}, 0, rootOffsetY);
}

// --
// Internal: recursive walker

/**
 * Recursive paint walker.
 *
 * @param node           - Current DOM node.
 * @param output         - Output to queue paint operations on.
 * @param inheritedStyle - Merged {@link TextStyles} from all ancestors.
 * @param offsetX        - Accumulated absolute X offset (sum of ancestor `left`).
 * @param offsetY        - Accumulated absolute Y offset (sum of ancestor `top`).
 */
function renderNodeInternal(
	node: TuiElement,
	output: Output,
	inheritedStyle: TextStyles,
	offsetX: number,
	offsetY: number,
	skipCache = false,
): void {
	const left = node.yogaNode.getComputedLeft();
	const top = node.yogaNode.getComputedTop();
	const width = node.yogaNode.getComputedWidth();
	const height = node.yogaNode.getComputedHeight();

	// Absolute screen-space origin of this node's border box.
	const x = offsetX + left;
	const y = offsetY + top;

	// Skip display:none and zero-area nodes.
	if (node.yogaNode.getDisplay() === LayoutDisplay.None) {
		return;
	}
	if (width <= 0 || height <= 0) {
		// Even when the node itself is skipped (zero area), legacy
		// per-frame state on `ink-legacy` nodes must be reset so stale
		// data from a previous frame doesn't leak. Without this, a
		// Kitty image that disappears (component returns [] → measure
		// height 0 → renderLegacy not called) would keep
		// `node.legacyKittyImages` populated with the previous frame's
		// image, and `TuiEngine.emitKittyImages` would still see the
		// image as "current", never emitting `deleteKittyImage`.
		if (node.nodeName === "ink-legacy") {
			node.legacyCursor = undefined;
			node.legacyKittyImages = undefined;
		}
		return;
	}

	// Cache the screen rect for hit-test. This is the absolute screen
	// position (after all offsets including rootOffsetY) so hit-test can
	// compare directly against terminal (col, row). Skip for nodes rendered
	// to a temp screen (scroll-box children) — their coordinates are in temp
	// screen space, not main screen space.
	if (!skipCache) {
		setNodeRect(node, { x, y, width, height, top });
	}

	// Merge inherited style with this node's TextStyles fields.
	const mergedStyle = mergeTextStyles(inheritedStyle, pickTextStyles(node.style));

	// -- Opaque fill: fill the entire box with spaces so nothing
	// behind shows through. Like backgroundColor but without a color.
	if (node.style.opaque === true) {
		const fillStyleId = output.internStyle(mergedStyle);
		output.fill(x, y, width, height, " ", fillStyleId);
	}

	// -- Background fill: fill the box with background-colored spaces.
	// The mergedStyle carries backgroundColor (if this node or an
	// ancestor set it), which the stylePool interns.
	if (node.style.backgroundColor !== undefined) {
		const fillStyleId = output.internStyle(mergedStyle);
		output.fill(x, y, width, height, " ", fillStyleId);
	}

	// -- Border: draw the 4 edges / corners if borderStyle is set.
	if (node.style.borderStyle !== undefined) {
		renderBorder(output, x, y, width, height, node.style.borderStyle, {
			borderTop: node.style.borderTop,
			borderBottom: node.style.borderBottom,
			borderLeft: node.style.borderLeft,
			borderRight: node.style.borderRight,
			borderColor: node.style.borderColor,
			borderDimColor: node.style.borderDimColor,
		});
	}

	// -- Compute content area (node box minus border and padding).
	const borderLeft = node.style.borderStyle !== undefined && node.style.borderLeft !== false ? 1 : 0;
	const borderRight = node.style.borderStyle !== undefined && node.style.borderRight !== false ? 1 : 0;
	const borderTop = node.style.borderStyle !== undefined && node.style.borderTop !== false ? 1 : 0;
	const borderBottom = node.style.borderStyle !== undefined && node.style.borderBottom !== false ? 1 : 0;

	const paddingLeft = node.yogaNode.getComputedPadding(LayoutEdge.Left);
	const paddingRight = node.yogaNode.getComputedPadding(LayoutEdge.Right);
	const paddingTop = node.yogaNode.getComputedPadding(LayoutEdge.Top);
	const paddingBottom = node.yogaNode.getComputedPadding(LayoutEdge.Bottom);

	const contentX = x + borderLeft + paddingLeft;
	const contentY = y + borderTop + paddingTop;
	const contentWidth = Math.max(0, width - borderLeft - borderRight - paddingLeft - paddingRight);
	const contentHeight = Math.max(0, height - borderTop - borderBottom - paddingTop - paddingBottom);

	// -- Dispatch by node name.
	switch (node.nodeName) {
		case "ink-text":
			renderTextNode(node, output, contentX, contentY, contentWidth, contentHeight, mergedStyle);
			break;
		case "ink-virtual-text":
			// Not rendered directly — parent's squash pass handles it.
			break;
		case "ink-link":
			// Recurse children with the merged style. Hyperlink href
			// extraction is deferred (Pi DOM has no attributes map).
			for (const child of node.childNodes) {
				renderNodeInternal(child, output, mergedStyle, x, y, skipCache);
			}
			break;
		case "ink-legacy":
			// Bridge: delegate to the wrapped legacy Component. The
			// component's render(width) produces lines that may contain
			// ANSI sequences and CURSOR_MARKER; renderLegacy strips
			// ANSI, records the cursor position on node.legacyCursor,
			// and writes plain text with the inherited styleId.
			renderLegacy(node, output, contentX, contentY, contentWidth, contentHeight, mergedStyle);
			break;
		case "ink-scroll-box": {
			// Resolve stickyScroll: if stickToBottom is set (by the
			// factory's stickyScroll default or by scrollToBottom), snap
			// scrollTop to the current maxScroll so newly appended
			// children stay visible.
			if (node.stickToBottom) {
				node.scrollTop = getMaxScroll(node);
			}

			// Compute total content height across children (max child bottom).
			let totalChildrenHeight = 0;
			for (const child of node.childNodes) {
				const childBottom = child.yogaNode.getComputedTop() + child.yogaNode.getComputedHeight();
				if (childBottom > totalChildrenHeight) {
					totalChildrenHeight = childBottom;
				}
			}
			node.scrollHeight = totalChildrenHeight;
			node.scrollViewportHeight = contentHeight;
			const maxScroll = Math.max(0, totalChildrenHeight - contentHeight);

			// Drain pendingScrollDelta: apply a portion of the accumulated
			// delta per frame so fast flicks show intermediate frames.
			let cur = node.scrollTop;
			const pending = node.pendingScrollDelta;
			if (pending !== undefined && pending !== 0) {
				const applied = drainProportional(node, pending, contentHeight);
				cur += applied;
			} else if (pending === 0) {
				node.pendingScrollDelta = undefined;
			}

			// Clamp scrollTop to [0, maxScroll].
			const scrollTop = Math.max(0, Math.min(cur, maxScroll));
			node.scrollTop = scrollTop;

			// If scrollTop hit the bounds, consume remaining delta.
			if (scrollTop !== cur) {
				node.pendingScrollDelta = undefined;
			}

			// Track if drain needs to continue next frame.
			if (node.pendingScrollDelta !== undefined && node.pendingScrollDelta !== 0) {
				scrollDrainNodes.add(node);
			} else {
				scrollDrainNodes.delete(node);
			}

			// Apply virtual-scroll clamp: if scrollTop raced past the
			// currently-mounted range, render at the edge of mounted
			// content instead of blank spacer. The clamped value is for
			// this paint only; node.scrollTop retains the real target.
			const cMin = node.scrollClampMin;
			const cMax = node.scrollClampMax;
			const haveClamp = cMin !== undefined && cMax !== undefined;
			const renderScrollTop = haveClamp ? Math.max(cMin, Math.min(scrollTop, cMax)) : scrollTop;

			if (contentWidth > 0 && contentHeight > 0 && totalChildrenHeight > 0) {
				// Render only a window around the visible slice, plus an
				// off-screen buffer above and below. This keeps long chat
				// histories responsive because components outside the
				// window are not rendered at all.
				const bufferLines = 5;
				const renderTop = renderScrollTop - bufferLines;
				const renderBottom = renderScrollTop + contentHeight + bufferLines;

				const mainScreen = output.getScreen();
				const tempHeight = contentHeight + 2 * bufferLines;
				const tempScreen = new Screen(contentWidth, tempHeight, {
					charPool: mainScreen.charPool,
					stylePool: mainScreen.stylePool,
					hyperlinkPool: mainScreen.hyperlinkPool,
				});
				const tempOutput = new Output(tempScreen);

				// Render children to the temp output with a vertical offset so
				// that the visible slice starts at bufferLines in the temp
				// screen. Skip children that fall completely outside the
				// render window.
				const offsetY = bufferLines - renderScrollTop;
				for (const child of node.childNodes) {
					const childTop = Math.round(child.yogaNode.getComputedTop());
					const childHeight = Math.round(child.yogaNode.getComputedHeight());
					const childBottom = childTop + childHeight;
					if (childBottom < renderTop || childTop > renderBottom) {
						continue;
					}
					renderNodeInternal(child, tempOutput, mergedStyle, 0, offsetY, true);
				}
				tempOutput.flush();

				// Blit the visible slice from the temp screen to the main
				// output. The slice starts at bufferLines in the temp screen.
				for (let dy = 0; dy < contentHeight; dy++) {
					const sy = bufferLines + dy;
					if (sy < 0 || sy >= tempScreen.height) continue;
					for (let dx = 0; dx < contentWidth; dx++) {
						const cell = tempScreen.getCell(dx, sy);
						// Skip empty cells (no content and no style) to avoid
						// needlessly queueing operations for blank cells.
						if (cell.char === " " && cell.styleId === 0) continue;
						output.writeText(contentX + dx, contentY + dy, cell.char, cell.styleId);
					}
				}

				// Render ↑N more indicator at top-right if renderScrollTop > 0.
				if (renderScrollTop > 0) {
					const indicator = `\u2191${Math.round(renderScrollTop)} more`;
					const indicatorWidth = visibleWidth(indicator);
					if (indicatorWidth <= contentWidth) {
						const dimStyle: TextStyles = { ...mergedStyle, dim: true };
						const styleId = output.internStyle(dimStyle);
						output.writeText(contentX + contentWidth - indicatorWidth, contentY, indicator, styleId);
					}
				}

				// Render ↓N more indicator at bottom-right if renderScrollTop < maxScroll.
				if (renderScrollTop < maxScroll) {
					const remaining = Math.round(maxScroll - renderScrollTop);
					const indicator = `\u2193${remaining} more`;
					const indicatorWidth = visibleWidth(indicator);
					if (indicatorWidth <= contentWidth) {
						const dimStyle: TextStyles = { ...mergedStyle, dim: true };
						const styleId = output.internStyle(dimStyle);
						const ix = contentX + contentWidth - indicatorWidth;
						const iy = contentY + contentHeight - 1;
						output.writeText(ix, iy, indicator, styleId);
					}
				}
			}
			break;
		}
		// ink-box, ink-root, and any unknown container: recurse children.
		default:
			for (const child of node.childNodes) {
				renderNodeInternal(child, output, mergedStyle, x, y, skipCache);
			}
			break;
	}
}

// --
// Text node rendering

/**
 * Render an `ink-text` node: squash its subtree into styled segments,
 * wrap each segment to the content width, and write the resulting lines
 * to the output.
 *
 * If the node has no children (common case), squashText returns a single
 * segment with the node's `textContent` and the inherited style.
 *
 * Lines beyond `contentHeight` are clipped (the text overflows the node's
 * box). Within each line, characters beyond `contentWidth` are clipped by
 * the wrap/truncate pass.
 */
function renderTextNode(
	node: TuiElement,
	output: Output,
	x: number,
	y: number,
	width: number,
	height: number,
	style: TextStyles,
): void {
	if (width <= 0 || height <= 0) return;

	// 1. Squash the subtree into styled segments.
	const segments = squashText(node, style);
	if (segments.length === 0) return;

	// 2. Wrap each segment to the content width and collect lines.
	const wrapMode = node.style.textWrap;
	const lines: Array<{ text: string; style: TextStyles }> = [];
	for (const segment of segments) {
		const wrappedLines = wrapText(segment.text, width, wrapMode);
		for (const line of wrappedLines) {
			lines.push({ text: line, style: segment.style });
		}
	}

	// 3. Write lines to output, clipping to contentHeight.
	const maxLines = Math.min(lines.length, height);
	for (let i = 0; i < maxLines; i++) {
		const line = lines[i]!;
		if (line.text.length === 0) continue;
		const styleId = output.internStyle(line.style);
		output.writeText(x, y + i, line.text, styleId);
	}
}

// --
// Style helpers

/**
 * Extract the {@link TextStyles} fields from a {@link Styles} object,
 * omitting `undefined` values so they don't clobber inherited styles
 * during the merge.
 */
function pickTextStyles(style: Styles): TextStyles {
	const result: TextStyles = {};
	if (style.color !== undefined) result.color = style.color;
	if (style.backgroundColor !== undefined) result.backgroundColor = style.backgroundColor;
	if (style.bold !== undefined) result.bold = style.bold;
	if (style.dim !== undefined) result.dim = style.dim;
	if (style.italic !== undefined) result.italic = style.italic;
	if (style.underline !== undefined) result.underline = style.underline;
	if (style.strikethrough !== undefined) result.strikethrough = style.strikethrough;
	if (style.inverse !== undefined) result.inverse = style.inverse;
	return result;
}

/**
 * Merge `override` into `base`, skipping `undefined` fields in `override`.
 * Returns a new object; neither input is mutated.
 */
function mergeTextStyles(base: TextStyles, override: TextStyles): TextStyles {
	const result: TextStyles = { ...base };
	if (override.color !== undefined) result.color = override.color;
	if (override.backgroundColor !== undefined) result.backgroundColor = override.backgroundColor;
	if (override.bold !== undefined) result.bold = override.bold;
	if (override.dim !== undefined) result.dim = override.dim;
	if (override.italic !== undefined) result.italic = override.italic;
	if (override.underline !== undefined) result.underline = override.underline;
	if (override.strikethrough !== undefined) result.strikethrough = override.strikethrough;
	if (override.inverse !== undefined) result.inverse = override.inverse;
	return result;
}
