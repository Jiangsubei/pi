/**
 * Minimal DOM tree for the TUI.
 *
 * Each {@link TuiElement} mirrors a Yoga layout node and tracks the
 * renderer-side state Yoga doesn't know about (style overrides, text
 * content, dirty flag, parent/child pointers). The tree is intentionally
 * shallow: there is no reconciler here, no diffing, no event dispatch —
 * the P0 caller builds the tree imperatively via {@link createNode} /
 * {@link appendChild} / {@link setStyle} and the renderer walks it.
 *
 * Reference: src/ink/dom.ts (484 lines, full version) — this file is the
 * minimal subset enumerated by the P0 task spec.
 */

import { stripBidiControls } from "../bidi.ts";
import type { EventListener, EventType } from "../events/synthetic-event.ts";
import type { LayoutMeasureMode, LayoutNode } from "../layout/node.ts";
import { LayoutEdge } from "../layout/node.ts";
import { createYogaLayoutNode } from "../layout/yoga.ts";
import type { Component } from "../tui.ts";
import { visibleWidth, wrapTextWithAnsi } from "../utils.ts";
import { applyStyles } from "./apply-styles.ts";
import type { NodeName, Styles } from "./types.ts";

// --
// TuiElement

/**
 * A node in the TUI DOM tree.
 *
 * Fields are intentionally public and mutable — the renderer and the
 * reconciler both read and write them directly. The {@link dirty} flag is
 * the only field callers are expected to set through a helper
 * ({@link markDirty}) rather than assigning directly, so ancestor
 * propagation stays consistent.
 */
export class TuiElement {
	nodeName: NodeName;
	style: Styles;
	yogaNode: LayoutNode;
	childNodes: TuiElement[] = [];
	parentNode: TuiElement | undefined;
	dirty = true;

	/**
	 * Marks this node as the root of a dirty subtree — i.e. this node
	 * (or one of its descendants) was directly mutated since the last
	 * render pass. Set by {@link markDirty} on the node passed in (the
	 * entry point of the mutation), NOT on ancestors (ancestors get
	 * `dirty = true` for layout propagation but stay
	 * `dirtySubtreeRoot = false`).
	 *
	 * The renderer collects every node with `dirtySubtreeRoot === true`
	 * after layout, reads its computed yoga rect, and merges those
	 * y-spans into a `dirtyYRanges` hint passed to the diff engine so
	 * only those rows are scanned. Cleared by the renderer's
	 * {@link clearDirty} walk after each render pass.
	 *
	 * P5 Task 32.3.
	 */
	dirtySubtreeRoot = false;

	textContent: string | undefined;
	component: Component | undefined;
	/**
	 * Cursor position extracted from a CURSOR_MARKER emitted by a wrapped
	 * legacy {@link Component} during the paint pass. Set by the bridge
	 * layer ({@link renderLegacy}); read by focus management (Task 19)
	 * to position the hardware cursor for IME.
	 *
	 * Coordinates are relative to the node's content origin (0-based):
	 * `row` is the line index within the rendered output, `col` is the
	 * visible column. `undefined` when the component emitted no marker.
	 */
	legacyCursor: { row: number; col: number } | undefined;

	/**
	 * Kitty graphics image lines extracted from a wrapped legacy
	 * {@link Component}'s render output during the paint pass. Set by
	 * the bridge layer ({@link renderLegacy}); read by
	 * {@link TuiEngine}'s renderLoop to emit raw Kitty APC sequences
	 * (`\x1b_G...`) at the correct screen positions and track image IDs
	 * for deletion across frames.
	 *
	 * Each entry captures the row index within the rendered output
	 * (relative to the node's content origin), the raw line (including
	 * the `\x1b_G...` APC sequence), and the parsed image IDs.
	 * `undefined` when the component emitted no Kitty images this frame.
	 */
	legacyKittyImages: Array<{ row: number; line: string; ids: number[] }> | undefined;

	/**
	 * Vertical scroll offset for `ink-scroll-box` nodes. The renderer
	 * shifts children up by this many rows during the paint pass and
	 * clips the visible region to the scroll-box's content area.
	 *
	 * Kept on {@link TuiElement} (rather than a separate structure) so
	 * the renderer and the scroll API share a single source of truth.
	 * For non-scroll-box nodes this field is unused and stays `0`.
	 *
	 * @default 0
	 */
	scrollTop = 0;

	/**
	 * Internal sticky-to-bottom flag for `ink-scroll-box` nodes with
	 * `style.stickyScroll === true`. When set, the renderer sets
	 * `scrollTop = maxScroll` on the next paint pass so newly appended
	 * children stay visible. Cleared by explicit `scrollTo`/`scrollBy`
	 * calls that move `scrollTop` away from the bottom.
	 *
	 * @default false
	 */
	stickToBottom = false;

	/**
	 * Accumulated scroll delta not yet applied to scrollTop. The renderer
	 * drains this at a capped rate per frame so fast flicks show
	 * intermediate frames instead of one big jump. Direction reversal
	 * naturally cancels (pure accumulator, no target tracking).
	 *
	 * `undefined` = no pending delta. Adapted from Claude Code's
	 * `pendingScrollDelta` on DOMElement.
	 */
	pendingScrollDelta: number | undefined;

	/**
	 * Render-time clamp bounds for virtual scroll. The scroll-box's
	 * scroll API writes the currently-mounted children's coverage span;
	 * render-node-to-output clamps scrollTop to stay within it.
	 * Prevents blank screen when scrollTo races past the mounted range.
	 * `undefined` = no clamp (sticky-scroll, cold start).
	 */
	scrollClampMin: number | undefined;
	scrollClampMax: number | undefined;

	/**
	 * Total content height and viewport height, computed at render time
	 * and stored for imperative access. Used by the drain logic and
	 * clamp calculations.
	 */
	scrollHeight: number | undefined;
	scrollViewportHeight: number | undefined;

	/**
	 * Registered event listeners keyed by event type. Populated by
	 * {@link TuiElement.addEventListener} and read by the dispatcher
	 * (`events/dispatcher.ts`). Defaults to an empty Map.
	 */
	listeners: Map<EventType, Set<EventListener>> = new Map();

	constructor(nodeName: NodeName, style?: Styles) {
		this.nodeName = nodeName;
		this.style = style ?? {};
		this.yogaNode = createYogaLayoutNode();
	}

	// --
	// Event listeners

	/**
	 * Register `listener` for `type` events on this node. The listener is
	 * invoked by {@link dispatchEvent} when a matching event bubbles
	 * through this node. Listeners are stored in insertion order within a
	 * type.
	 */
	addEventListener(type: EventType, listener: EventListener): void {
		let set = this.listeners.get(type);
		if (set === undefined) {
			set = new Set();
			this.listeners.set(type, set);
		}
		set.add(listener);
	}

	/**
	 * Remove a previously-registered `listener` for `type`. No-op if the
	 * listener was never added or already removed.
	 */
	removeEventListener(type: EventType, listener: EventListener): void {
		const set = this.listeners.get(type);
		if (set === undefined) return;
		set.delete(listener);
	}
}

// --
// Construction

/**
 * Create a new {@link TuiElement} with the given tag name and optional
 * initial style. A fresh Yoga layout node is allocated and attached.
 *
 * Layout-affecting style fields are translated to Yoga node setters via
 * {@link applyStyles}. For `ink-text` leaves a measure function
 * is installed so Yoga can size the node from its text content.
 */
export function createNode(nodeName: NodeName, style?: Styles): TuiElement {
	const node = new TuiElement(nodeName, style);
	applyStyles(node.yogaNode, node.style);

	if (nodeName === "ink-text") {
		node.yogaNode.setMeasureFunc((width: number, widthMode: LayoutMeasureMode) => {
			// Strip bidi formatting controls (LRM/RLM/LRE/RLE/PDF/LRO/RLO)
			// before measuring. They are zero-width Cf characters; stripping
			// them keeps visibleWidth and wrapTextWithAnsi operating on the
			// visible content only, so layout matches the painted cells.
			const text = stripBidiControls(node.textContent ?? "");
			const textWidth = visibleWidth(text);
			// When the parent constrains the width (mode "exactly"), use it;
			// otherwise cap at the text width so the node doesn't claim more
			// space than its content needs.
			const resolvedWidth = widthMode === "exactly" ? width : Math.min(textWidth, width || textWidth);

			// P1: compute height from the wrap mode. Wrap modes produce as
			// many lines as wrapTextWithAnsi reports; truncate modes always
			// fit on one line. When the text already fits in resolvedWidth,
			// height is 1 regardless of mode.
			let height = 1;
			const wrap = node.style.textWrap;
			const isWrapMode = wrap === undefined || wrap === "wrap" || wrap === "wrap-trim";
			if (isWrapMode && resolvedWidth > 0 && textWidth > resolvedWidth) {
				height = wrapTextWithAnsi(text, resolvedWidth).length;
			}
			return { width: resolvedWidth, height };
		});
	}

	return node;
}

// --
// Tree mutation

/**
 * Append `child` to `parent`, synchronizing both the DOM `childNodes`
 * array and the underlying Yoga tree. The child's `parentNode` is set to
 * `parent`, and `parent` is marked dirty.
 *
 * If `child` is already a child of `parent`, this is equivalent to moving
 * it to the end (DOM standard semantics for `appendChild` on an attached
 * node). If `child` is currently a child of another parent, it is first
 * detached from that parent.
 */
export function appendChild(parent: TuiElement, child: TuiElement): void {
	// Detach from current parent (if any). This covers both "already a child
	// of `parent`" (move to end) and "child of another node" (transfer).
	if (child.parentNode !== undefined) {
		removeChild(child.parentNode, child);
	}
	child.parentNode = parent;
	parent.childNodes.push(child);
	// Index = childNodes.length - 1 because we just pushed; this keeps the
	// Yoga child order in lockstep with the DOM child order.
	parent.yogaNode.insertChild(child.yogaNode, parent.childNodes.length - 1);
	markDirty(parent);
}

/**
 * Insert `child` into `parent` immediately before `referenceNode`. If
 * `referenceNode` is `null`, `child` is appended to the end (equivalent
 * to {@link appendChild}). Synchronizes the DOM `childNodes` array and the
 * underlying Yoga tree.
 *
 * If `child` is already attached (to this parent or another), it is first
 * detached — so calling `insertBefore` on an already-attached node moves
 * it to the new position. This matches DOM standard `insertBefore`
 * semantics and is required by `syncChildrenToEngine`'s reconciliation
 * pass, which reorders existing children in place.
 */
export function insertBefore(parent: TuiElement, child: TuiElement, referenceNode: TuiElement | null): void {
	// Detach from current parent (if any). Avoids double-insertion into yoga
	// and keeps the DOM/Yoga indices in lockstep.
	if (child.parentNode !== undefined) {
		removeChild(child.parentNode, child);
	}
	let index: number;
	if (referenceNode === null) {
		index = parent.childNodes.length;
	} else {
		index = parent.childNodes.indexOf(referenceNode);
		if (index === -1) {
			// Reference node is not a child of parent — fall back to append.
			// Matches DOM behavior (NotFoundError) but is more lenient; useful
			// for reconciliation code that may race with concurrent mutation.
			index = parent.childNodes.length;
		}
	}
	child.parentNode = parent;
	parent.childNodes.splice(index, 0, child);
	parent.yogaNode.insertChild(child.yogaNode, index);
	markDirty(parent);
}

/**
 * Remove `child` from `parent`, synchronizing both trees. If the child is
 * not present, this is a no-op. The child's `parentNode` is cleared.
 */
export function removeChild(parent: TuiElement, child: TuiElement): void {
	const index = parent.childNodes.indexOf(child);
	if (index === -1) return;
	parent.childNodes.splice(index, 1);
	child.parentNode = undefined;
	parent.yogaNode.removeChild(child.yogaNode);
	markDirty(parent);
}

// --
// Dirty tracking

/**
 * Mark `node` and every ancestor as dirty. Stops early at the first
 * ancestor that is already dirty — a dirty ancestor implies its ancestors
 * are already marked, so the walk is O(depth) in the worst case and O(1)
 * in the steady state.
 *
 * Also marks `node` (the entry point of the mutation) as a dirty subtree
 * root via {@link TuiElement.dirtySubtreeRoot}. The renderer collects
 * every dirty subtree root after layout and restricts the diff to those
 * y-ranges. Ancestors are NOT marked as dirty subtree roots — they only
 * carry the `dirty` flag for layout propagation, while `node` carries
 * the smaller (more precise) dirty rect.
 *
 * Marking `node.dirtySubtreeRoot = true` unconditionally (even when
 * `node` was already dirty) is correct: a subsequent direct mutation
 * of `node` (e.g. `setStyle` after an earlier `appendChild` of a child)
 * means `node`'s own rect is now a candidate dirty region, not just
 * the child's. The renderer's y-range merger dedupes overlapping ranges
 * from ancestor/child pairs.
 */
export function markDirty(node: TuiElement): void {
	let current: TuiElement | undefined = node;
	while (current !== undefined && !current.dirty) {
		current.dirty = true;
		current = current.parentNode;
	}
	node.dirtySubtreeRoot = true;
}

// --
// Style and text

/**
 * Merge `style` into `node.style` (shallow Object.assign — top-level
 * fields are replaced, which matches Ink's behavior) and mark the node
 * dirty so the next render pass picks up the change.
 *
 * The merge happens before {@link applyStyles} so the resolved
 * `node.style` (passed as the third argument) reflects the new values.
 * `style` itself (the delta) is passed as the second argument so only
 * the changed fields trigger Yoga setters; {@link applyBorderStyles}
 * reads border side props from the resolved style to handle diffs that
 * change `borderStyle` without re-listing the border side booleans.
 */
export function setStyle(node: TuiElement, style: Partial<Styles>): void {
	Object.assign(node.style, style);
	applyStyles(node.yogaNode, style, node.style);
	markDirty(node);
}

/**
 * Set `node.textContent` and mark the node dirty. The text is read by the
 * renderer during the paint pass; for Yoga the text affects the measure
 * function's reported size, so the dirty flag is what triggers
 * re-layout on the next pass.
 */
export function setTextContent(node: TuiElement, text: string): void {
	node.textContent = text;
	node.yogaNode.markDirty();
	markDirty(node);
}

// --
// Scroll helpers

/**
 * Compute the maximum scroll offset for an `ink-scroll-box` node.
 *
 * `maxScroll = max(0, totalChildrenHeight - contentHeight)` where
 * `totalChildrenHeight` is the bottom edge of the lowest child
 * (max of `child.computedTop + child.computedHeight`) relative to the
 * scroll-box's content box, and `contentHeight` is the scroll-box's
 * content area height (computed height minus border and padding).
 *
 * Requires Yoga layout to have been calculated
 * (`node.yogaNode.calculateLayout()` on the root). Before the first
 * layout pass, all computed values are 0, so `getMaxScroll` returns 0.
 *
 * For non-scroll-box nodes the result is 0 (no scrollable content).
 */
export function getMaxScroll(node: TuiElement): number {
	if (node.childNodes.length === 0) return 0;

	const borderEdge = (side: boolean | undefined): number =>
		node.style.borderStyle !== undefined && side !== false ? 1 : 0;
	const borderTop = borderEdge(node.style.borderTop);
	const borderBottom = borderEdge(node.style.borderBottom);
	const paddingTop = node.yogaNode.getComputedPadding(LayoutEdge.Top);
	const paddingBottom = node.yogaNode.getComputedPadding(LayoutEdge.Bottom);
	const computedHeight = node.yogaNode.getComputedHeight();
	const contentHeight = Math.max(0, computedHeight - borderTop - borderBottom - paddingTop - paddingBottom);

	let totalChildrenHeight = 0;
	for (const child of node.childNodes) {
		const childBottom = child.yogaNode.getComputedTop() + child.yogaNode.getComputedHeight();
		if (childBottom > totalChildrenHeight) {
			totalChildrenHeight = childBottom;
		}
	}
	return Math.max(0, totalChildrenHeight - contentHeight);
}
