/**
 * Box factory — convenience constructor for an `ink-box` element.
 *
 * Wraps {@link createNode} with the `ink-box` tag name so callers don't
 * have to repeat the literal at every call site. Style overrides are
 * passed straight through to the underlying node.
 *
 * P0 component — see `packages/tui/src/components-new/README` (if present).
 */

import type { TuiElement } from "../dom/tree.ts";
import { createNode } from "../dom/tree.ts";
import type { Styles } from "../dom/types.ts";

/**
 * Create an `ink-box` element with optional initial style. The box is
 * the standard flex container in the DOM tree.
 */
export function createBox(style?: Styles): TuiElement {
	return createNode("ink-box", style);
}
