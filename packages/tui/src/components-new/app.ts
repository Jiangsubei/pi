/**
 * App factory — convenience constructor for the `ink-root` element.
 *
 * The root sits at the top of the tree and is sized to fill the
 * terminal (`100%` x `100%`) with a column flex direction, matching
 * the layout the engine sets up in `TuiEngine`'s constructor. Use this
 * when constructing a tree without an engine instance (e.g. in tests).
 */

import type { TuiElement } from "../dom/tree.ts";
import { createNode } from "../dom/tree.ts";

/**
 * Create an `ink-root` element with the default root layout:
 * `flexDirection: "column"`, `width: "100%"`, `height: "100%"`.
 */
export function createApp(): TuiElement {
	return createNode("ink-root", {
		flexDirection: "column",
		width: "100%",
		height: "100%",
	});
}
