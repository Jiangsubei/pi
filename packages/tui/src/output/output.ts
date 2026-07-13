/**
 * Output — operation collector that flushes queued paint operations to a
 * {@link Screen}.
 *
 * The renderer ({@link renderNode}) walks the DOM tree and calls
 * {@link Output.writeText} / {@link Output.fill} to describe what should be
 * painted. Operations are appended to an internal queue and only applied to
 * the underlying {@link Screen} when {@link Output.flush} is called. This
 * decouples the paint pass from the cell-level write so the renderer can run
 * without touching the buffer and flush can be retried or reordered later.
 *
 * P0 scope: only `writeText` and `fill` are implemented. There is no clip
 * region, no blit, no row shift. The `styleId` is a 2-bit flag pack
 * (bit 0 = has background, bit 1 = has foreground) — P1 will replace this
 * with a full {@link StylePool} that maps real style objects to integer IDs.
 *
 * Reference: src/ink/output.ts (full version) — this file is the minimal
 * subset enumerated by the P0 task spec.
 */

import type { TextStyles } from "../dom/types.ts";
import type { Cell } from "../screen/cell.ts";
import type { Screen } from "../screen/screen.ts";
import { getGraphemeSegmenter, visibleWidth } from "../utils.ts";

// --
// Operation types

/**
 * A single queued paint operation.
 *
 * - `write`: place a string of text at `(x, y)`, advancing the cursor by
 *   each grapheme's visible width (1 for ASCII, 2 for CJK/emoji).
 * - `fill`: paint a solid rectangle of identical cells, used for
 *   background fills.
 *
 * Both carry a `styleId` (see module doc for the P0 encoding).
 */
export type WriteOperation =
	| { type: "write"; x: number; y: number; text: string; styleId: number }
	| { type: "fill"; x: number; y: number; w: number; h: number; char: string; styleId: number };

// --
// Output

/**
 * Operation collector backed by a {@link Screen}.
 *
 * Usage:
 * 1. Construct with a Screen instance.
 * 2. Call {@link writeText} / {@link fill} during the paint pass.
 * 3. Call {@link flush} to apply all queued operations to the Screen.
 * 4. Call {@link getScreen} to read the resulting buffer.
 *
 * The queue is cleared on each {@link flush}, so a single Output instance can
 * be reused across render frames.
 */
export class Output {
	private screen: Screen;
	private operations: WriteOperation[] = [];

	constructor(screen: Screen) {
		this.screen = screen;
	}

	/**
	 * Queue a text write at `(x, y)`. Multi-cell graphemes (CJK, emoji) occupy
	 * more than one column; the cursor advances by each grapheme's visible
	 * width. Newlines terminate the write (P0 does not implement wrapping).
	 */
	writeText(x: number, y: number, text: string, styleId: number): void {
		this.operations.push({ type: "write", x, y, text, styleId });
	}

	/**
	 * Queue a rectangular fill from `(x, y)` with size `(w, h)`. Every cell in
	 * the region is set to `char` with the given `styleId`. Typically used with
	 * `" "` to paint a background color.
	 */
	fill(x: number, y: number, w: number, h: number, char: string, styleId: number): void {
		this.operations.push({ type: "fill", x, y, w, h, char, styleId });
	}

	/**
	 * Apply all queued operations to the Screen in insertion order, then clear
	 * the queue. Operations are applied immediately (no batching, no reorder);
	 * later operations overwrite earlier ones at the same cell.
	 */
	flush(): void {
		for (const op of this.operations) {
			if (op.type === "write") {
				this.applyWrite(op);
			} else {
				this.applyFill(op);
			}
		}
		this.operations.length = 0;
	}

	/**
	 * Return the Screen backing this Output. Call after {@link flush} to read
	 * the painted buffer.
	 */
	getScreen(): Screen {
		return this.screen;
	}

	/**
	 * Number of queued operations. Useful for diagnostics and for the renderer
	 * to decide whether a flush is needed at all.
	 */
	getPendingCount(): number {
		return this.operations.length;
	}

	/**
	 * Intern a {@link TextStyles} object via the Screen's {@link StylePool}
	 * and return the resulting numeric `styleId`. The renderer calls this
	 * to obtain a compact ID for a style before queuing write/fill
	 * operations, so cells reference styles by integer rather than by
	 * embedded ANSI sequences.
	 */
	internStyle(style: TextStyles): number {
		return this.screen.stylePool.add(style);
	}

	// --
	// Internal: apply single operations

	/**
	 * Apply a write operation: iterate graphemes, compute each one's visible
	 * width, build a {@link Cell}, and call `screen.setCell`. Zero-width
	 * graphemes (combining marks, ZWJ) are skipped. `\n` stops the write;
	 * `\r` is ignored.
	 *
	 * Wide graphemes (width 2, e.g. CJK or emoji) occupy two cells: the
	 * leading cell carries the character with `width: 2`, and the trailing
	 * cell is set to a `width: 0` placeholder so the cursor does not render
	 * anything there.
	 */
	private applyWrite(op: { x: number; y: number; text: string; styleId: number }): void {
		const segmenter = getGraphemeSegmenter();
		let x = op.x;
		const y = op.y;
		for (const { segment } of segmenter.segment(op.text)) {
			if (segment === "\n") {
				break;
			}
			if (segment === "\r") {
				continue;
			}
			const w = visibleWidth(segment);
			if (w === 0) {
				continue;
			}
			const cell: Cell = { char: segment, width: w, styleId: op.styleId };
			this.screen.setCell(x, y, cell);
			if (w === 2) {
				this.screen.setCell(x + 1, y, { char: "", width: 0, styleId: op.styleId });
			}
			x += w;
		}
	}

	/**
	 * Apply a fill operation: delegate to {@link Screen.fill}, which stamps
	 * `char` into every cell of the rectangle with the given `styleId`. The
	 * Screen handles bounds checking and allocates fresh cell objects.
	 */
	private applyFill(op: { x: number; y: number; w: number; h: number; char: string; styleId: number }): void {
		this.screen.fill(op.x, op.y, op.w, op.h, op.char, op.styleId);
	}
}

// --
// styleId helpers

/**
 * P0 styleId encoding (2 bits):
 * - bit 0 (value 1): has background color
 * - bit 1 (value 2): has foreground color
 *
 * `styleId = (hasFg ? 2 : 0) | (hasBg ? 1 : 0)`.
 * P1 will replace this with a full {@link StylePool} lookup.
 */
export function packStyleId(hasFg: boolean, hasBg: boolean): number {
	return (hasFg ? 2 : 0) | (hasBg ? 1 : 0);
}
