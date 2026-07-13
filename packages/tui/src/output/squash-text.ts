/**
 * Squash-text — flatten a DOM subtree into an array of styled text
 * segments.
 *
 * The renderer calls {@link squashText} on an `ink-text` node (or any
 * container) to gather all the text that should be rendered inside it,
 * along with the {@link TextStyles} each run of text inherits from its
 * ancestors. This lets the paint pass write text with per-segment styles
 * without embedding ANSI sequences in the cell buffer.
 *
 * Style inheritance:
 *   - `ink-box` / `ink-root`: contribute their {@link TextStyles} fields
 *     (color, bold, italic, …) to all descendant text.
 *   - `ink-text`: contributes its own {@link TextStyles} and emits its
 *     `textContent` as a segment.
 *   - `ink-virtual-text`: does NOT contribute styles — it passes the
 *     inherited styles through and emits its `textContent`.
 *   - `ink-link`: currently treated as a container (hyperlink href
 *     extraction is deferred until Pi's DOM has an attributes map).
 *
 * Reference: Claude Code `src/ink/squash-text-nodes.ts` (91 lines).
 */

import { reorderVisual } from "../bidi.ts";
import type { TuiElement } from "../dom/tree.ts";
import type { Styles, TextStyles } from "../dom/types.ts";

// --
// StyledSegment

/**
 * A run of text with its inherited {@link TextStyles}.
 *
 * - `text`: the literal string content.
 * - `style`: the merged {@link TextStyles} from all ancestors (and the
 *   emitting `ink-text` node itself).
 * - `hyperlink`: the OSC 8 URI if this segment is inside an `ink-link`
 *   (currently always `undefined` until Pi's DOM gains an `href`
 *   attribute on `ink-link` nodes).
 */
export interface StyledSegment {
	text: string;
	style: TextStyles;
	hyperlink?: string;
}

// --
// Public API

/**
 * Recursively flatten `node`'s subtree into {@link StyledSegment}s.
 *
 * `inheritedStyle` is the merged {@link TextStyles} from all ancestors
 * of `node`; the function merges `node`'s own {@link TextStyles} fields
 * (if any) before recursing or emitting.
 *
 * Returns an empty array if the subtree contains no text.
 *
 * Each emitted segment's `text` is reordered from logical to visual
 * order via {@link reorderVisual} so the renderer can paint it
 * left-to-right without re-running the bidi algorithm per cell.
 */
export function squashText(node: TuiElement, inheritedStyle: TextStyles = {}): StyledSegment[] {
	const out: StyledSegment[] = [];
	squashTextInternal(node, inheritedStyle, undefined, out);
	// Apply visual reordering per segment: strip bidi controls and
	// reverse contiguous RTL runs so segment text is in paint order.
	for (const segment of out) {
		if (segment.text.length > 0) {
			segment.text = reorderVisual(segment.text)
				.map((v) => v.char)
				.join("");
		}
	}
	return out;
}

// --
// Internal

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

/**
 * Recursive walker. Appends segments to `out`.
 *
 * `inheritedHyperlink` is the URI inherited from an ancestor `ink-link`.
 * Currently always `undefined` (Pi's DOM has no href attribute yet).
 */
function squashTextInternal(
	node: TuiElement,
	inheritedStyle: TextStyles,
	inheritedHyperlink: string | undefined,
	out: StyledSegment[],
): void {
	switch (node.nodeName) {
		case "ink-text": {
			// ink-text contributes its own TextStyles and emits text.
			const merged = mergeTextStyles(inheritedStyle, pickTextStyles(node.style));
			if (node.childNodes.length > 0) {
				for (const child of node.childNodes) {
					squashTextInternal(child, merged, inheritedHyperlink, out);
				}
			} else {
				const text = node.textContent ?? "";
				if (text.length > 0) {
					out.push({ text, style: merged, hyperlink: inheritedHyperlink });
				}
			}
			break;
		}
		case "ink-virtual-text": {
			// ink-virtual-text does NOT contribute styles — pass through.
			if (node.childNodes.length > 0) {
				for (const child of node.childNodes) {
					squashTextInternal(child, inheritedStyle, inheritedHyperlink, out);
				}
			} else {
				const text = node.textContent ?? "";
				if (text.length > 0) {
					out.push({ text, style: inheritedStyle, hyperlink: inheritedHyperlink });
				}
			}
			break;
		}
		case "ink-link": {
			// ink-link: currently no href extraction (Pi DOM has no
			// attributes map). Treat as a container that contributes
			// TextStyles. When href support lands, extract it here and
			// pass it as inheritedHyperlink to children.
			const merged = mergeTextStyles(inheritedStyle, pickTextStyles(node.style));
			for (const child of node.childNodes) {
				squashTextInternal(child, merged, inheritedHyperlink, out);
			}
			break;
		}
		// ink-box, ink-root, and any unknown container: merge TextStyles
		// and recurse children.
		default: {
			const merged = mergeTextStyles(inheritedStyle, pickTextStyles(node.style));
			for (const child of node.childNodes) {
				squashTextInternal(child, merged, inheritedHyperlink, out);
			}
			break;
		}
	}
}
