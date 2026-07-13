/**
 * Bidirectional text (RTL) support — simplified base-direction detection
 * and visual reordering.
 *
 * This is NOT a full Unicode Bidirectional Algorithm (UAX #9)
 * implementation. It handles the common case needed by terminal
 * renderers: detect whether a run of text is RTL, and reverse
 * contiguous RTL runs so they paint right-to-left on screen.
 *
 * Limitations vs. UBA:
 *   - No mirroring of paired brackets.
 *   - No explicit-embedding (LRE/RLE/LRO/RLO/PDF) handling beyond
 *     stripping the controls before measuring and reordering.
 *   - Numbers and neutrals adopt the direction of the surrounding
 *     run rather than the Wn / Nn rules; in practice this matches
 *     what users expect at this layer.
 *
 * Reference: Claude Code `src/ink/bidi.ts` (no upstream equivalent —
 * Pi's TUI needs its own because the screen cell buffer stores
 * characters in visual order).
 */

import { getGraphemeSegmenter } from "./utils.ts";

// --
// Constants

/**
 * Bidirectional formatting control characters that have no visual
 * width and must be stripped before width measurement and reordering:
 *
 *   U+200E LRM  Left-to-Right Mark
 *   U+200F RLM  Right-to-Left Mark
 *   U+202A LRE  Left-to-Right Embedding
 *   U+202B RLE  Right-to-Left Embedding
 *   U+202C PDF  Pop Directional Formatting
 *   U+202D LRO  Left-to-Right Override
 *   U+202E RLO  Right-to-Left Override
 */
const BIDI_CONTROL_REGEX = /[\u200E\u200F\u202A-\u202E]/g;

/**
 * Match a single codepoint whose Unicode script is inherently
 * right-to-left. Covers Hebrew, Arabic (incl. Supplement and
 * Presentation Forms), Syriac, Thaana, Nko, and Mandaic.
 */
const RTL_SCRIPT_REGEX =
	/[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Mandaic}]/u;

/** Match a single codepoint that is a Unicode letter (L*). */
const LETTER_REGEX = /\p{L}/u;

// --
// Types

export type BaseDirection = "ltr" | "rtl" | "neutral";

/**
 * A single grapheme in visual order, with the logical position it
 * came from. {@link visualIndex} is the index in the visual output
 * array; {@link logicalIndex} is the index in the source grapheme
 * array (after bidi-control stripping).
 */
export interface VisualChar {
	char: string;
	visualIndex: number;
	logicalIndex: number;
}

// --
// Public API

/**
 * Remove Unicode bidirectional formatting controls from `text`.
 *
 * The controls stripped are listed in {@link BIDI_CONTROL_REGEX}.
 * All are zero-width `Cf` (Format) characters; stripping them does
 * not change the visible content of the string.
 */
export function stripBidiControls(text: string): string {
	if (
		!text.includes("\u200E") &&
		!text.includes("\u200F") &&
		!text.includes("\u202A") &&
		!text.includes("\u202B") &&
		!text.includes("\u202C") &&
		!text.includes("\u202D") &&
		!text.includes("\u202E")
	) {
		return text;
	}
	return text.replace(BIDI_CONTROL_REGEX, "");
}

/**
 * Determine the base direction of `text` from its first strong
 * directional character.
 *
 * - Returns `"ltr"` if the first letter is from an LTR script.
 * - Returns `"rtl"` if the first letter is from an RTL script
 *   (Hebrew, Arabic, Syriac, Thaana, Nko, Mandaic).
 * - Returns `"neutral"` if `text` contains no strong-direction
 *   characters (digits, punctuation, symbols, empty).
 *
 * Bidi control characters are stripped before scanning.
 */
export function getBaseDirection(text: string): BaseDirection {
	const cleaned = stripBidiControls(text);
	for (const { segment } of getGraphemeSegmenter().segment(cleaned)) {
		const cp = segment.codePointAt(0);
		if (cp === undefined) continue;
		const ch = String.fromCodePoint(cp);
		if (RTL_SCRIPT_REGEX.test(ch)) return "rtl";
		if (LETTER_REGEX.test(ch)) return "ltr";
	}
	return "neutral";
}

/**
 * Reorder `text` from logical order to visual order.
 *
 * Algorithm (simplified UBA):
 *
 * 1. Strip bidi control characters.
 * 2. Segment the result into grapheme clusters.
 * 3. Group consecutive graphemes into runs of the same direction
 *    (RTL = first codepoint's script is RTL; LTR = otherwise).
 * 4. LTR runs keep their logical order; RTL runs are reversed.
 *
 * Returns one {@link VisualChar} per grapheme in visual order, with
 * each entry's `logicalIndex` pointing back to its position in the
 * post-strip grapheme array.
 */
export function reorderVisual(text: string): VisualChar[] {
	const cleaned = stripBidiControls(text);
	const graphemes: string[] = [];
	for (const { segment } of getGraphemeSegmenter().segment(cleaned)) {
		graphemes.push(segment);
	}

	const out: VisualChar[] = [];
	let visualIndex = 0;

	let i = 0;
	while (i < graphemes.length) {
		const isRtlRun = isRtlGrapheme(graphemes[i]);
		let end = i + 1;
		while (end < graphemes.length && isRtlGrapheme(graphemes[end]) === isRtlRun) {
			end++;
		}

		if (isRtlRun) {
			for (let j = end - 1; j >= i; j--) {
				out.push({ char: graphemes[j], visualIndex, logicalIndex: j });
				visualIndex++;
			}
		} else {
			for (let j = i; j < end; j++) {
				out.push({ char: graphemes[j], visualIndex, logicalIndex: j });
				visualIndex++;
			}
		}
		i = end;
	}

	return out;
}

// --
// Internal

/** True if the first codepoint of `grapheme` belongs to an RTL script. */
function isRtlGrapheme(grapheme: string): boolean {
	const cp = grapheme.codePointAt(0);
	if (cp === undefined) return false;
	return RTL_SCRIPT_REGEX.test(String.fromCodePoint(cp));
}
