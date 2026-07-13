/**
 * Text factory — convenience constructor for an `ink-text` element.
 *
 * Creates an `ink-text` node and assigns its initial `textContent` in
 * one step, since the pair is the dominant P0 use case. Further text
 * updates should go through {@link setTextContent} in `../dom/tree.ts`
 * so the dirty flag is propagated correctly.
 */

import type { TuiElement } from "../dom/tree.ts";
import { createNode } from "../dom/tree.ts";
import type { Styles } from "../dom/types.ts";

/**
 * Create an `ink-text` element with the given text and optional style.
 * The text is written to `node.textContent`, which the renderer reads
 * during the paint pass.
 */
export function createText(text: string, style?: Styles): TuiElement {
	const node = createNode("ink-text", style);
	node.textContent = text;
	return node;
}
