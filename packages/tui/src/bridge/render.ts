/**
 * Paint pass for ink-legacy nodes.
 *
 * {@link renderLegacy} is called by {@link renderNode} (see
 * `output/render-node.ts`) when it encounters an `ink-legacy` node. It
 * delegates content production to the wrapped {@link Component}'s
 * `render(width)` and writes the resulting lines to the {@link Output}.
 *
 * ## ANSI handling
 *
 * Legacy components return strings that may contain ANSI escape
 * sequences: SGR styling (colors, bold, …), OSC hyperlinks, and APC
 * sequences like {@link CURSOR_MARKER}. Pi's {@link Output.writeText}
 * is cell-based: it segments text by grapheme and skips zero-width
 * graphemes (ESC, BEL), which would corrupt any ANSI-bearing string —
 * the inner bytes of an escape sequence (`[`, `3`, `1`, `m`, …) would
 * be stamped into cells as visible characters.
 *
 * Per the P2 task spec ("不解析 ANSI 为 styleId（暂时）"), this module
 * does not parse component-emitted ANSI into the {@link StylePool}.
 * Instead it strips ANSI sequences and writes the plain visible text,
 * applying only the inherited {@link TextStyles} from ancestor nodes
 * (via {@link Output.internStyle}). Component-specific styling (e.g.
 * Editor cursor highlight, Text `customBgFn`) is deferred to P5, where
 * the bridge will translate SGR runs into styleId transitions.
 *
 * ## CURSOR_MARKER preservation
 *
 * {@link CURSOR_MARKER} (`\x1b_pi:c\x07`) is a zero-width APC sequence
 * emitted by {@link Focusable} components (e.g. Editor) at the cursor
 * position. The cell pipeline cannot represent zero-width sequences, so
 * the marker itself cannot survive {@link Output.writeText}. Instead,
 * {@link renderLegacy} extracts the marker's position (row within the
 * rendered output, visible column) and stores it on
 * {@link TuiElement.legacyCursor}. Task 19's focus management reads
 * this field to position the hardware cursor for IME — the cursor
 * information is preserved even though the marker bytes are not emitted
 * to the terminal.
 *
 * Reference: Claude Code's `ink-raw-ansi` path calls
 * `output.write(x, y, text)` which parses ANSI directly into cells
 * (src/ink/render-node-to-output.ts). Pi's Output has no such parser,
 * so the bridge preprocesses instead.
 */

import type { TuiElement } from "../dom/tree.ts";
import type { TextStyles } from "../dom/types.ts";
import type { Output } from "../output/output.ts";
import { isImageLine } from "../terminal-image.ts";
import { CURSOR_MARKER, extractKittyImageIds } from "../tui.ts";
import { extractAnsiCode, visibleWidth } from "../utils.ts";

// --
// Public API

/**
 * Render an `ink-legacy` node's content to `output`.
 *
 * @param node - The `ink-legacy` node. `node.component` must be set;
 *   otherwise this is a no-op.
 * @param output - The {@link Output} to queue paint operations on.
 * @param x - Absolute screen column of the node's content origin.
 * @param y - Absolute screen row of the node's content origin.
 * @param width - Content width in columns (already minus padding/border).
 * @param height - Content height in rows (already minus padding/border).
 * @param inheritedStyle - Merged {@link TextStyles} from ancestors; the
 *   rendered text is interned with this style so colors/bold/etc.
 *   propagate from parent `ink-box` nodes.
 */
export function renderLegacy(
	node: TuiElement,
	output: Output,
	x: number,
	y: number,
	width: number,
	height: number,
	inheritedStyle: TextStyles = {},
): void {
	const component = node.component;
	if (component === undefined) {
		return;
	}

	// Reset cursor state for this frame. If the component no longer
	// emits a marker, legacyCursor stays undefined.
	node.legacyCursor = undefined;
	// Reset Kitty image state for this frame. If the component no longer
	// emits image lines, legacyKittyImages stays undefined.
	node.legacyKittyImages = undefined;

	const lines = component.render(width);

	// Intern the inherited style once for all lines. StylePool.add is a
	// dedup map, so repeated calls with the same TextStyles are cheap.
	const styleId = output.internStyle(inheritedStyle);

	const maxLines = Math.min(lines.length, height);
	for (let lineIdx = 0; lineIdx < maxLines; lineIdx++) {
		const line = lines[lineIdx];
		if (line === undefined) {
			continue;
		}

		// Extract CURSOR_MARKER before stripping. The marker's column is
		// the visible width of the text preceding it (ANSI sequences have
		// zero width, so they don't shift the column). Only the first
		// marker per frame is recorded — a component should emit at most
		// one, and recording the first keeps behavior predictable.
		if (node.legacyCursor === undefined) {
			const markerIndex = line.indexOf(CURSOR_MARKER);
			if (markerIndex !== -1) {
				const col = visibleWidth(line.slice(0, markerIndex));
				node.legacyCursor = { row: lineIdx, col };
			}
		}

		// Detect Kitty/iTerm2 image lines BEFORE stripping. Image lines
		// contain raw APC/OSC sequences (`\x1b_G...` / `\x1b]1337;File=`)
		// that the cell-based Screen cannot represent. The raw line is
		// stored on the node for TuiEngine.renderLoop to emit as a raw
		// passthrough after the diff output, and the image IDs are
		// tracked for cross-frame deletion via deleteKittyImage.
		// Image lines have no visible text content, so writeText is
		// skipped entirely.
		if (isImageLine(line)) {
			const ids = extractKittyImageIds(line);
			if (node.legacyKittyImages === undefined) {
				node.legacyKittyImages = [];
			}
			node.legacyKittyImages.push({ row: lineIdx, line, ids });
			continue;
		}

		// Strip ANSI sequences (CSI/OSC/APC) to get plain visible text.
		// See module doc for why this is necessary.
		const plainText = stripAnsiSequences(line);

		// Skip empty lines (no visible content to write).
		if (plainText.length === 0) {
			continue;
		}

		output.writeText(x, y + lineIdx, plainText, styleId);
	}
}

// --
// Internal: ANSI stripping

/**
 * Remove all ANSI escape sequences (CSI, OSC, APC) from `text`, leaving
 * only visible characters.
 *
 * Uses {@link extractAnsiCode} to recognize the same sequence types that
 * {@link visibleWidth} strips, so the visible width of the result equals
 * the visible width of the input. Control characters not part of a
 * recognized escape (lone ESC, lone BEL) are left in place —
 * {@link Output.writeText}'s grapheme segmenter skips zero-width
 * control graphemes, so they don't corrupt the cell grid.
 */
function stripAnsiSequences(text: string): string {
	if (!text.includes("\x1b")) {
		return text;
	}
	let result = "";
	let i = 0;
	while (i < text.length) {
		const ansi = extractAnsiCode(text, i);
		if (ansi !== null) {
			i += ansi.length;
			continue;
		}
		result += text[i];
		i++;
	}
	return result;
}
