/**
 * Hit testing — find the deepest node containing a terminal coordinate.
 *
 * Primary path: uses the nodeCache populated during the paint pass (see
 * `dom/node-cache.ts`). Each rendered node's absolute screen rect is
 * cached, so hit-test compares directly against terminal (col, row)
 * without computing Yoga coordinates on the fly. This is both faster
 * and correct for scroll-box children whose painted position differs
 * from their Yoga layout position due to the scrollTop offset.
 *
 * Fallback path: when a node has no cache entry (not yet rendered, or
 * the caller is testing a raw DOM tree without the render loop), hit-test
 * falls back to computing Yoga coordinates on the fly. This preserves
 * backward compatibility for tests and direct DOM usage.
 *
 * Adapted from Claude Code's `hit-test.ts` nodeCache approach.
 */

import { getNodeRect } from "../dom/node-cache.ts";
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
	const rect = getNodeRect(root);
	if (rect !== undefined) {
		// Cache path: compare against cached screen coordinates.
		if (x < rect.x || x >= rect.x + rect.width || y < rect.y || y >= rect.y + rect.height) {
			return null;
		}
		for (let i = root.childNodes.length - 1; i >= 0; i--) {
			const child = root.childNodes[i]!;
			const hit = hitTest(child, x, y);
			if (hit !== null) return hit;
		}
		return root;
	}
	// Fallback path: compute Yoga coordinates on the fly (for tests
	// and direct DOM usage without rendering).
	return hitTestYoga(root, x, y);
}

function hitTestYoga(node: TuiElement, x: number, y: number): TuiElement | null {
	const left = node.yogaNode.getComputedLeft();
	const top = node.yogaNode.getComputedTop();
	const width = node.yogaNode.getComputedWidth();
	const height = node.yogaNode.getComputedHeight();

	if (x < left || x >= left + width || y < top || y >= top + height) {
		return null;
	}

	const localX = x - left;
	const localY = y - top;

	for (let i = node.childNodes.length - 1; i >= 0; i--) {
		const child = node.childNodes[i]!;
		const hit = hitTestYoga(child, localX, localY);
		if (hit !== null) return hit;
	}

	return node;
}
