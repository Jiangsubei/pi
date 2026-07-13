/**
 * nodeCache — screen-coordinate cache for hit testing.
 *
 * During the paint pass ({@link renderNodeInternal}), each rendered node's
 * absolute screen rect (x, y, width, height) is stored here. The hit-test
 * ({@link hitTest}) reads from this cache instead of computing Yoga
 * coordinates on the fly, which is faster and—crucially—correct for
 * scroll-box children whose painted position differs from their Yoga
 * layout position due to the scrollTop offset.
 *
 * The cache is cleared at the start of each render pass and repopulated
 * as nodes are painted. Nodes that were not rendered (e.g. scroll-box
 * children outside the visible window) have no cache entry and are
 * skipped by hit-test.
 *
 * Adapted from Claude Code's `node-cache.ts` + `hit-test.ts` pattern.
 */

import type { TuiElement } from "./tree.ts";

export interface NodeRect {
	x: number;
	y: number;
	width: number;
	height: number;
	/** Layout-space top (before scrollTop offset), for scroll calculations. */
	top: number;
}

const cache = new Map<TuiElement, NodeRect>();

/** Clear all entries. Called at the start of each render pass. */
export function clearNodeCache(): void {
	cache.clear();
}

/** Store the screen rect for a node. Called during the paint pass. */
export function setNodeRect(node: TuiElement, rect: NodeRect): void {
	cache.set(node, rect);
}

/** Retrieve the cached screen rect, or `undefined` if not rendered this frame. */
export function getNodeRect(node: TuiElement): NodeRect | undefined {
	return cache.get(node);
}
