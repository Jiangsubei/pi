/**
 * Hit testing — find the deepest node containing a terminal coordinate.
 *
 * Used by mouse event dispatch (P4 Task 27) to resolve the target node
 * from a (col, row) pair. Walks the tree depth-first, preferring
 * later-appended children so `position: absolute` overlays (appended
 * after normal-flow siblings by {@link OverlayManager}) are hit first.
 *
 * Coordinates: `x` / `y` are relative to the root's parent. Since the
 * root is typically the top of the tree, this is terminal screen space.
 * Each recursion subtracts the child's computed left/top so children
 * are tested in their own local space.
 *
 * Reference: Task 25 spec (SubTask 25.4).
 */

import type { TuiElement } from "../dom/tree.ts";

/**
 * Find the deepest descendant of `root` containing `(x, y)`, or `null`
 * if the point is outside `root`.
 *
 * Children are iterated back-to-front so the last-appended child
 * (highest z-order) is preferred. This naturally supports
 * `position: absolute` overlays appended after normal-flow siblings.
 */
export function hitTest(root: TuiElement, x: number, y: number): TuiElement | null {
	return hitTestNode(root, x, y);
}

function hitTestNode(node: TuiElement, x: number, y: number): TuiElement | null {
	const left = node.yogaNode.getComputedLeft();
	const top = node.yogaNode.getComputedTop();
	const width = node.yogaNode.getComputedWidth();
	const height = node.yogaNode.getComputedHeight();

	// Reject points outside the node's border box. Yoga positions are
	// relative to the parent, matching the coordinate space of (x, y).
	if (x < left || x >= left + width || y < top || y >= top + height) {
		return null;
	}

	// Convert to node-local coordinates for child hit testing.
	const localX = x - left;
	const localY = y - top;

	// Iterate children back to front so later-appended (top z-order)
	// nodes are hit-tested first.
	for (let i = node.childNodes.length - 1; i >= 0; i--) {
		const child = node.childNodes[i]!;
		const hit = hitTestNode(child, localX, localY);
		if (hit !== null) return hit;
	}

	// No child contains the point; the node itself is the hit.
	return node;
}
