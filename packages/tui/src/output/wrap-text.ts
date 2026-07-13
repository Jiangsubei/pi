/**
 * Wrap-text — wrap or truncate text to fit a given visible width.
 *
 * Wraps the {@link Styles.textWrap} values defined in the DOM types
 * to Pi's existing width-aware utilities in `utils.ts`:
 *
 * - `wrap` / `wrap-trim`: word-wrap via {@link wrapTextWithAnsi}
 *   (already trims trailing whitespace per line).
 * - `truncate` / `truncate-end` / `end`: truncate at the end with `…`.
 * - `truncate-middle` / `middle`: preserve first and last halves, insert
 *   `…` in the middle.
 * - `truncate-start`: preserve the tail, prefix with `…`.
 *
 * Reference: Claude Code `src/ink/wrap-text.ts` (74 lines).
 */

import type { Styles } from "../dom/types.ts";
import { sliceByColumn, visibleWidth, wrapTextWithAnsi } from "../utils.ts";

// --
// Types

/** Re-exported so callers don't need a second import for the wrap mode. */
export type TextWrapMode = Styles["textWrap"];

const ELLIPSIS = "\u2026";

// --
// Public API

/**
 * Wrap or truncate `text` to fit `width` visible columns.
 *
 * - Wrap modes return one string per wrapped line.
 * - Truncate modes return a single-element array (one line).
 *
 * An empty `mode` (or `undefined`) defaults to `"wrap"`.
 */
export function wrapText(text: string, width: number, mode: TextWrapMode = "wrap"): string[] {
	if (width <= 0) {
		return [""];
	}

	// Wrap modes
	if (mode === undefined || mode === "wrap" || mode === "wrap-trim") {
		return wrapTextWithAnsi(text, width);
	}

	// Truncate modes
	return [truncate(text, width, mode)];
}

// --
// Internal

/**
 * Truncate `text` to `width` columns according to the truncate mode.
 *
 * - `truncate` / `truncate-end` / `end`: keep the first `width-1`
 *   columns, append `…`.
 * - `truncate-middle` / `middle`: keep the first `floor(width/2)` and
 *   the last `width-floor(width/2)-1` columns, join with `…`.
 * - `truncate-start`: keep the last `width-1` columns, prefix with `…`.
 *
 * All cases use {@link sliceByColumn} with `strict=true` (rather than Pi's
 * `truncateToWidth`) because the renderer writes one grapheme per Screen
 * cell. Strict mode excludes a wide grapheme that starts within the
 * requested range but would extend past it, so the truncated prefix never
 * overflows the requested width (a CJK char cannot be split in half).
 *
 * `sliceByColumn` is preferred over `truncateToWidth` because the latter
 * embeds `\x1b[0m` reset codes between the prefix and the ellipsis, which
 * would land in cells as literal escape characters instead of style
 * transitions. `sliceByColumn` returns plain text — wide characters and
 * ANSI codes in the input are still respected, but no synthetic resets are
 * inserted.
 */
function truncate(text: string, width: number, mode: TextWrapMode): string {
	if (width < 1) return "";
	if (width === 1) return ELLIPSIS;

	const vw = visibleWidth(text);
	if (vw <= width) return text;

	// End truncation: first (width-1) columns + ….
	if (mode === "truncate" || mode === "truncate-end" || mode === "end") {
		const first = sliceByColumn(text, 0, width - 1, true);
		return first + ELLIPSIS;
	}

	// Middle truncation: first half + … + last half.
	if (mode === "truncate-middle" || mode === "middle") {
		const half = Math.floor(width / 2);
		const first = sliceByColumn(text, 0, half, true);
		const lastLen = width - half - 1;
		const last = sliceByColumn(text, vw - lastLen, lastLen, true);
		return first + ELLIPSIS + last;
	}

	// Start truncation: … + tail.
	if (mode === "truncate-start") {
		const last = sliceByColumn(text, vw - (width - 1), width - 1, true);
		return ELLIPSIS + last;
	}

	// Unknown mode: return text as-is.
	return text;
}
