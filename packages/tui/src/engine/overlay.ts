/**
 * Overlay adapter for the new TuiEngine.
 *
 * Maps Pi's existing Overlay system (defined in `tui.ts`) to the new
 * Yoga-backed DOM tree via `position: absolute`. This module is the P2
 * counterpart to `engine/focus.ts` and lives alongside it.
 *
 * The existing `TUI` class in `tui.ts` continues to work unchanged — this
 * module provides a parallel implementation for the new engine. Task 20
 * (TUI migration) decides when to switch.
 *
 * Key mappings:
 * - `OverlayAnchor` (9 anchors) → `Styles.top/bottom/left/right`
 * - z-order → DOM child order (`appendChild`); later children paint on top
 * - `OverlayHandle.hide/setHidden/focus/unfocus` → `OverlayManager` methods
 * - `visible()` callback → `display: "none"` when false at show time
 *
 * Unlike the legacy system which composites overlays manually in
 * `compositeOverlays`, the new engine lets Yoga position absolute nodes
 * and the renderer paints them in DOM order — so z-order falls out of
 * child order for free.
 *
 * Reference: `tui.ts` `OverlayOptions`, `resolveOverlayLayout`,
 * `compositeOverlays`, `resolveAnchorRow`, `resolveAnchorCol`.
 */

import { wrapComponent } from "../bridge/adapter.ts";
import { appendChild, removeChild, setStyle, type TuiElement } from "../dom/tree.ts";
import type { DimensionValue, Styles } from "../dom/types.ts";
import type { Terminal } from "../terminal.ts";
import type { Component, OverlayHandle, OverlayMargin, OverlayOptions, OverlayUnfocusOptions } from "../tui.ts";
import { parseSizeValue } from "../utils.ts";

// --
// Size parsing: `parseSizeValue` is now imported from `../utils.ts`
// (shared with `tui.ts`). Previously duplicated here.

/** Normalize a margin shorthand: number → all sides, object → as-is, undefined → empty. */
function normalizeMargin(margin: OverlayMargin | number | undefined): OverlayMargin {
	if (margin === undefined) return {};
	if (typeof margin === "number") return { top: margin, right: margin, bottom: margin, left: margin };
	return margin;
}

// --
// overlayOptionsToStyles

/**
 * Convert {@link OverlayOptions} to a {@link Styles} object using
 * `position: absolute`.
 *
 * Position is computed in absolute cells (not percentages) so that
 * `offsetX`/`offsetY` can be applied uniformly. Centering requires the
 * overlay's own dimensions, which the caller must supply via
 * `overlayWidth` / `overlayHeight` (pre-measured by rendering the
 * component, the same approach as the legacy `resolveOverlayLayout`).
 *
 * Anchor → edge mapping (matches `resolveAnchorRow` / `resolveAnchorCol`
 * in `tui.ts`):
 *
 * | anchor          | vertical edge | horizontal edge |
 * |-----------------|---------------|-----------------|
 * | top-left        | top           | left            |
 * | top-center      | top           | left (centered) |
 * | top-right       | top           | right           |
 * | left-center     | top (centered)| left            |
 * | center          | top (centered)| left (centered) |
 * | right-center    | top (centered)| right           |
 * | bottom-left     | bottom        | left            |
 * | bottom-center   | bottom        | left (centered) |
 * | bottom-right    | bottom        | right           |
 *
 * Explicit `row` / `col` override the anchor's vertical / horizontal
 * position respectively.
 *
 * @param options       Overlay positioning options.
 * @param termWidth     Terminal width in columns.
 * @param termHeight     Terminal height in rows.
 * @param overlayHeight Pre-measured overlay height (used for centering + clamping).
 * @returns A `Styles` object with `position: "absolute"` and the
 *   resolved `top`/`bottom`/`left`/`right`/`width`/`maxHeight` fields.
 */
export function overlayOptionsToStyles(
	options: OverlayOptions,
	termWidth: number,
	termHeight: number,
	overlayHeight: number,
): Styles {
	// --- Margin (clamp to non-negative, same as legacy) ---
	const margin = normalizeMargin(options.margin);
	const marginTop = Math.max(0, margin.top ?? 0);
	const marginRight = Math.max(0, margin.right ?? 0);
	const marginBottom = Math.max(0, margin.bottom ?? 0);
	const marginLeft = Math.max(0, margin.left ?? 0);

	const availWidth = Math.max(1, termWidth - marginLeft - marginRight);
	const availHeight = Math.max(1, termHeight - marginTop - marginBottom);

	// --- Width (clamp to available, same as legacy) ---
	let width = parseSizeValue(options.width, termWidth) ?? Math.min(80, availWidth);
	if (options.minWidth !== undefined && width < options.minWidth) {
		width = options.minWidth;
	}
	width = Math.max(1, Math.min(width, availWidth));

	// --- maxHeight (clamp to available) ---
	let maxHeight = parseSizeValue(options.maxHeight, termHeight);
	if (maxHeight !== undefined) {
		maxHeight = Math.max(1, Math.min(maxHeight, availHeight));
	}
	const effectiveHeight = maxHeight !== undefined ? Math.min(overlayHeight, maxHeight) : overlayHeight;

	const offsetX = options.offsetX ?? 0;
	const offsetY = options.offsetY ?? 0;
	const anchor = options.anchor ?? "center";

	// --- Vertical position ---
	// top/bottom as DimensionValue (number, since we compute in cells).
	let top: DimensionValue | undefined;
	let bottom: DimensionValue | undefined;
	if (options.row !== undefined) {
		const row = parseSizeValue(options.row, termHeight);
		if (row !== undefined) {
			top = row + offsetY;
		}
	} else {
		switch (anchor) {
			case "top-left":
			case "top-center":
			case "top-right": {
				top = marginTop + offsetY;
				break;
			}
			case "bottom-left":
			case "bottom-center":
			case "bottom-right": {
				bottom = marginBottom - offsetY;
				break;
			}
			case "center":
			case "left-center":
			case "right-center": {
				top = marginTop + Math.floor((availHeight - effectiveHeight) / 2) + offsetY;
				break;
			}
		}
	}

	// --- Horizontal position ---
	let left: DimensionValue | undefined;
	let right: DimensionValue | undefined;
	if (options.col !== undefined) {
		const col = parseSizeValue(options.col, termWidth);
		if (col !== undefined) {
			left = col + offsetX;
		}
	} else {
		switch (anchor) {
			case "top-left":
			case "left-center":
			case "bottom-left": {
				left = marginLeft + offsetX;
				break;
			}
			case "top-right":
			case "right-center":
			case "bottom-right": {
				right = marginRight - offsetX;
				break;
			}
			case "center":
			case "top-center":
			case "bottom-center": {
				left = marginLeft + Math.floor((availWidth - width) / 2) + offsetX;
				break;
			}
		}
	}

	// Build the Styles object (all fields are readonly, so construct at once).
	const styles: Styles = {
		position: "absolute",
		width,
		...(top !== undefined ? { top } : {}),
		...(bottom !== undefined ? { bottom } : {}),
		...(left !== undefined ? { left } : {}),
		...(right !== undefined ? { right } : {}),
		...(maxHeight !== undefined ? { maxHeight } : {}),
	};
	return styles;
}

// --
// OverlayManager

/**
 * Internal bookkeeping for one shown overlay.
 *
 * `hidden` tracks the user-controlled visibility (via `setHidden`).
 * The `visible()` callback is evaluated at show time and re-evaluated
 * when `setHidden(false)` is called; if it returns false the overlay
 * stays hidden via `display: "none"`.
 */
interface OverlayEntry {
	id: number;
	node: TuiElement;
	component: Component;
	options: OverlayOptions;
	hidden: boolean;
}

/**
 * Handle returned by {@link OverlayManager.show} for controlling an
 * overlay. Extends the legacy {@link OverlayHandle} with a `node`
 * field exposing the backing DOM node (for direct style manipulation
 * or integration with Task 19's focus manager).
 */
export interface NewOverlayHandle extends OverlayHandle {
	/** The DOM node backing this overlay. */
	readonly node: TuiElement;
}

/**
 * Manages a stack of absolutely-positioned overlay nodes attached to a
 * root DOM node.
 *
 * z-order is determined by DOM child order: the first overlay shown is
 * the first child of the root and paints on the bottom; the most recent
 * overlay is the last child and paints on top. This mirrors the legacy
 * system's `focusOrder`-sorted compositing, but falls out of `appendChild`
 * for free — no explicit sort needed.
 *
 * Focus is tracked locally (which overlay ID has focus). The actual
 * component-level focus (setting `component.focused`, routing keyboard
 * input) is handled by Task 19's `FocusManager`; this class only records
 * which overlay is the current focus target so `isFocused` / `unfocus`
 * behave correctly.
 *
 * Construct with a {@link TuiElement} root (typically
 * `engine.rootNode`) and a {@link Terminal} (for dimensions). The
 * manager does not schedule renders — the caller ({@link TuiEngine})
 * calls `requestRender` after `show` / `hide` / `setHidden`.
 */
export class OverlayManager {
	private readonly overlays = new Map<number, OverlayEntry>();
	/** Overlay IDs in append order (z-order: first = bottom, last = top). */
	private readonly order: number[] = [];
	private nextId = 1;
	private focusedId: number | undefined;

	private readonly rootNode: TuiElement;
	private readonly terminal: Terminal;

	constructor(rootNode: TuiElement, terminal: Terminal) {
		this.rootNode = rootNode;
		this.terminal = terminal;
	}

	/**
	 * Show an overlay component with the given positioning options.
	 *
	 * The component is pre-rendered at the resolved width to measure its
	 * height (same approach as the legacy `resolveOverlayLayout`), then
	 * wrapped as an `ink-legacy` DOM node with `position: absolute` styles
	 * and appended to the root.
	 *
	 * If `options.visible` is provided and returns false at show time,
	 * the overlay is appended with `display: "none"` and marked hidden.
	 *
	 * If `options.nonCapturing` is false (default) and the overlay is
	 * visible, it becomes the focused overlay.
	 *
	 * Does NOT schedule a render — the caller is responsible for calling
	 * `requestRender` (or similar) after this returns.
	 *
	 * @param component The legacy component to wrap.
	 * @param options   Positioning and sizing options.
	 * @returns A handle for controlling the overlay.
	 */
	show(component: Component, options: OverlayOptions): NewOverlayHandle {
		const id = this.nextId++;
		const termWidth = this.terminal.columns;
		const termHeight = this.terminal.rows;

		// Pre-measure: render at the resolved width to get overlay height.
		// Matches the legacy resolveOverlayLayout(width, 0) → render → re-resolve flow.
		const measureStyles = overlayOptionsToStyles(options, termWidth, termHeight, 0);
		const resolvedWidth = typeof measureStyles.width === "number" ? measureStyles.width : Math.min(80, termWidth);
		const overlayLines = component.render(resolvedWidth);
		let overlayHeight = overlayLines.length;
		const maxHeight = measureStyles.maxHeight;
		if (typeof maxHeight === "number" && overlayHeight > maxHeight) {
			overlayHeight = maxHeight;
		}

		// Re-compute styles with the measured height (centering needs it).
		const baseStyles = overlayOptionsToStyles(options, termWidth, termHeight, overlayHeight);

		// Evaluate visibility callback at show time.
		const visible = options.visible ? options.visible(termWidth, termHeight) : true;
		// Styles fields are readonly, so rebuild with spread rather than mutating.
		const styles: Styles = visible ? baseStyles : { ...baseStyles, display: "none" };

		const node = wrapComponent(component, styles);
		appendChild(this.rootNode, node);

		const entry: OverlayEntry = { id, node, component, options, hidden: !visible };
		this.overlays.set(id, entry);
		this.order.push(id);

		if (!options.nonCapturing && visible) {
			this.focusedId = id;
		}

		return this.createHandle(id);
	}

	/** Permanently remove the overlay from the DOM and manager. */
	private hide(id: number): void {
		const entry = this.overlays.get(id);
		if (!entry) return;
		removeChild(this.rootNode, entry.node);
		this.overlays.delete(id);
		const idx = this.order.indexOf(id);
		if (idx !== -1) this.order.splice(idx, 1);
		if (this.focusedId === id) {
			this.focusedId = this.topmostVisibleCapturingId(id);
		}
	}

	/** Temporarily hide or show the overlay via `display: none` / `flex`. */
	private setHidden(id: number, hidden: boolean): void {
		const entry = this.overlays.get(id);
		if (!entry || entry.hidden === hidden) return;
		entry.hidden = hidden;
		setStyle(entry.node, { display: hidden ? "none" : "flex" });

		// If unhiding, re-check the visible() callback.
		if (!hidden && entry.options.visible) {
			const isVisible = entry.options.visible(this.terminal.columns, this.terminal.rows);
			if (!isVisible) {
				entry.hidden = true;
				setStyle(entry.node, { display: "none" });
				return;
			}
		}

		// Update local focus tracking.
		if (hidden && this.focusedId === id) {
			this.focusedId = this.topmostVisibleCapturingId(id);
		} else if (!hidden && !entry.options.nonCapturing && this.focusedId === undefined) {
			this.focusedId = id;
		}
	}

	private isHidden(id: number): boolean {
		const entry = this.overlays.get(id);
		return entry?.hidden ?? false;
	}

	/**
	 * Mark this overlay as the focused one and bring it to the visual
	 * front by reordering DOM children.
	 *
	 * z-order in the new engine is determined by DOM child order: the
	 * last child of the root paints on top. Legacy `compositeOverlays`
	 * sorts overlays by `focusOrder` (re-focus bumps the order counter,
	 * lifting the overlay visually); to match that semantics here, we
	 * move the focused overlay's node to the end of the root's
	 * `childNodes` (DOM-standard `appendChild` on an already-attached
	 * node is a move). The {@link order} array is updated in lockstep so
	 * `topmostVisibleCapturingId` and `hide` continue to see a consistent
	 * ordering.
	 *
	 * Idempotent: a no-op if `id` is already focused or already the
	 * topmost child (avoids spurious yoga mutations and dirty marks).
	 */
	private focus(id: number): void {
		const entry = this.overlays.get(id);
		if (!entry || entry.hidden) return;
		if (this.focusedId === id) return; // already focused
		this.focusedId = id;
		const idx = this.order.indexOf(id);
		if (idx === -1 || idx === this.order.length - 1) return; // not found / already topmost
		// Move to top: splice from current position, push to end, and
		// re-attach the DOM node so it becomes the last child of root.
		this.order.splice(idx, 1);
		this.order.push(id);
		appendChild(this.rootNode, entry.node);
	}

	/**
	 * Release focus from this overlay.
	 *
	 * If `options.target` is provided, focus is cleared (the caller /
	 * Task 19's FocusManager is responsible for actually focusing the
	 * target component). Otherwise, focus moves to the next visible
	 * capturing overlay, or is cleared if none remain.
	 */
	private unfocus(id: number, options?: OverlayUnfocusOptions): void {
		if (this.focusedId !== id) return;
		if (options?.target !== undefined) {
			// Explicit target — just clear our tracking. Task 19 handles
			// the actual component focus transition.
			this.focusedId = undefined;
			return;
		}
		this.focusedId = this.topmostVisibleCapturingId(id);
	}

	private isFocused(id: number): boolean {
		return this.focusedId === id;
	}

	/**
	 * Find the topmost (last-appended) visible capturing overlay,
	 * excluding `excludeId`. Returns undefined if none qualify.
	 */
	private topmostVisibleCapturingId(excludeId: number): number | undefined {
		for (let i = this.order.length - 1; i >= 0; i--) {
			const oid = this.order[i];
			if (oid === excludeId) continue;
			const entry = this.overlays.get(oid);
			if (!entry || entry.hidden || entry.options.nonCapturing) continue;
			return oid;
		}
		return undefined;
	}

	/** Build the public handle for overlay `id`. Captures the node reference so it stays valid after `hide()`. */
	private createHandle(id: number): NewOverlayHandle {
		const entry = this.overlays.get(id);
		if (!entry) throw new Error(`Overlay ${id} not found`);
		const node = entry.node;
		return {
			node,
			hide: () => this.hide(id),
			setHidden: (hidden: boolean) => this.setHidden(id, hidden),
			isHidden: () => this.isHidden(id),
			focus: () => this.focus(id),
			unfocus: (opts?: OverlayUnfocusOptions) => this.unfocus(id, opts),
			isFocused: () => this.isFocused(id),
		};
	}
}
