/**
 * Measure function for ink-legacy nodes.
 *
 * The bridge wraps an existing {@link Component} as an `ink-legacy`
 * {@link TuiElement}. Yoga needs a measure function to size the node,
 * so this module installs one that delegates to
 * `component.render(width)` and reports the returned line count as the
 * node height.
 *
 * Yoga calls the measure function during layout with a width constraint
 * and a mode describing how strictly that width should be treated:
 * - `"exactly"`: the parent fixed the width — use it verbatim.
 * - `"at-most"` / `"undefined"`: the width is an upper bound or unset;
 *   fall back to a sensible default (80) so leaf components that ignore
 *   the width argument still produce stable output.
 *
 * The returned `height` is `lines.length`. CURSOR_MARKER is a zero-width
 * APC sequence and does not affect `visibleWidth`, so it needs no special
 * handling here — the line count returned by `render` already accounts
 * for it.
 *
 * Reference: Claude Code measures `ink-raw-ansi` nodes from
 * pre-computed `rawWidth`/`rawHeight` attributes (src/ink/dom.ts). Pi
 * components compute their dimensions lazily via `render(width)`, so we
 * call it directly.
 */

import type { TuiElement } from "../dom/tree.ts";
import type { LayoutMeasureMode } from "../layout/node.ts";
import type { Component } from "../tui.ts";

// --
// Default width fallback

/** Width assumed when Yoga gives no constraint and the parent passes 0. */
const DEFAULT_MEASURE_WIDTH = 80;

// --
// Public API

/**
 * Install a Yoga measure function on `node` that delegates to
 * `component.render(width)`.
 *
 * The function is bound to `component` (captured by closure), so the
 * caller does not need to keep a reference alongside the node. The
 * component's `render` is invoked synchronously during Yoga's layout
 * pass; components with async state (e.g. Editor autocomplete) return
 * their currently-rendered lines, which is the correct behavior for
 * measure — the layout grows once the async state updates and the node
 * is marked dirty.
 *
 * @param node - The `ink-legacy` {@link TuiElement} whose Yoga node will
 *   receive the measure function.
 * @param component - The wrapped {@link Component} to measure.
 */
export function setLegacyMeasureFunc(node: TuiElement, component: Component): void {
	node.yogaNode.setMeasureFunc((width: number, widthMode: LayoutMeasureMode) => {
		// Resolve the width to measure at. When the parent constrains the
		// width (mode "exactly"), use it verbatim. Otherwise the width is
		// an upper bound or unset; fall back to the default so leaf
		// components that ignore `width` still produce a stable height.
		const resolvedWidth = widthMode === "exactly" ? width : Math.max(1, width || DEFAULT_MEASURE_WIDTH);

		const lines = component.render(resolvedWidth);
		const height = lines.length;
		return { width: resolvedWidth, height };
	});
}
