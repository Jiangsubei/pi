/**
 * SelectionManager — rectangular text selection with OSC 52 clipboard copy.
 *
 * Tracks a rectangular selection region on the screen. The user starts a
 * selection (typically via Alt+mouse-drag), drags to extend it, and
 * releases to copy the selected text to the system clipboard via the
 * OSC 52 escape sequence.
 *
 * The selection region is a rectangle from `(startCol, startRow)` to
 * `(endCol, endRow)`. The rectangle is normalized so that start ≤ end
 * regardless of drag direction.
 *
 * {@link getHighlightPredicate} returns a function that tests whether a
 * cell is inside the selection rectangle. The renderer uses this to apply
 * inverse styling (fg ↔ bg swap) to selected cells during the diff pass.
 *
 * OSC 52 sequence format:
 *   `\x1b]52;c;<base64-encoded-text>\x07`
 * where `c` selects the system clipboard. The text is UTF-8 encoded and
 * base64-encoded per the OSC 52 specification.
 *
 * Reference: https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h2-Operating-System-Commands
 */

import type { HighlightPredicate } from "./highlight.ts";
import type { Screen } from "./screen/screen.ts";
import type { Terminal } from "./terminal.ts";

// --
// SelectionManager

export class SelectionManager {
	/** Whether the user is currently dragging to extend the selection. */
	private active = false;

	/** Selection start point (where the mouse was pressed). */
	private startCol = 0;
	private startRow = 0;

	/** Current selection end point (where the mouse was dragged to). */
	private endCol = 0;
	private endRow = 0;

	/** Reference to the current screen, used to read cell text for copy. */
	private screen: Screen | null = null;

	/** Terminal to write OSC 52 sequences to. */
	private readonly terminal: Terminal;

	constructor(terminal: Terminal) {
		this.terminal = terminal;
	}

	/**
	 * Update the screen reference. Called by the engine after each render
	 * pass so {@link copyToClipboard} can read the latest cell text.
	 */
	setScreen(screen: Screen): void {
		this.screen = screen;
	}

	// --
	// State machine

	/**
	 * Enter selection mode and record the start point.
	 * The end point is initialized to the start point so the initial
	 * selection is a single cell.
	 */
	startSelection(col: number, row: number): void {
		this.active = true;
		this.startCol = col;
		this.startRow = row;
		this.endCol = col;
		this.endRow = row;
	}

	/**
	 * Update the end point of the selection. No-op when not active
	 * (e.g. if the mouse moves without Alt being held).
	 */
	updateSelection(col: number, row: number): void {
		if (!this.active) return;
		this.endCol = col;
		this.endRow = row;
	}

	/**
	 * Exit selection mode. If there is an active selection and a screen
	 * reference, the selected text is copied to the clipboard via OSC 52.
	 * After copying, the selection state is cleared so the highlight
	 * predicate returns false for all cells.
	 */
	endSelection(): void {
		if (!this.active) return;
		this.active = false;
		this.copyToClipboard();
	}

	/** Whether the user is currently in selection mode (Alt+drag). */
	isInSelectionMode(): boolean {
		return this.active;
	}

	// --
	// Highlight

	/**
	 * Return a predicate that returns true for cells inside the current
	 * selection rectangle. When the selection is inactive, returns a
	 * predicate that always returns false.
	 *
	 * The rectangle is normalized: the predicate checks whether `(x, y)`
	 * falls within `[min(startCol, endCol), max(startCol, endCol)]` ×
	 * `[min(startRow, endRow), max(startRow, endRow)]`.
	 */
	getHighlightPredicate(): HighlightPredicate {
		if (!this.active) {
			return () => false;
		}
		const minCol = Math.min(this.startCol, this.endCol);
		const maxCol = Math.max(this.startCol, this.endCol);
		const minRow = Math.min(this.startRow, this.endRow);
		const maxRow = Math.max(this.startRow, this.endRow);
		return (x: number, y: number): boolean => {
			return x >= minCol && x <= maxCol && y >= minRow && y <= maxRow;
		};
	}

	/**
	 * Return the current selection region as a list of rows, each with
	 * the list of column indices that are part of the selection.
	 * Returns `null` when the selection is inactive.
	 */
	getHighlightedRegion(): Array<{ row: number; cols: number[] }> | null {
		if (!this.active) return null;
		const minCol = Math.min(this.startCol, this.endCol);
		const maxCol = Math.max(this.startCol, this.endCol);
		const minRow = Math.min(this.startRow, this.endRow);
		const maxRow = Math.max(this.startRow, this.endRow);
		const result: Array<{ row: number; cols: number[] }> = [];
		for (let y = minRow; y <= maxRow; y++) {
			const cols: number[] = [];
			for (let x = minCol; x <= maxCol; x++) {
				cols.push(x);
			}
			result.push({ row: y, cols });
		}
		return result;
	}

	// --
	// OSC 52 copy

	/**
	 * Read the selected text from the screen and emit an OSC 52 sequence
	 * to copy it to the system clipboard.
	 *
	 * The text is assembled by walking the selection rectangle row by
	 * row. For each row, cells from `minCol` to `maxCol` are read and
	 * their `char` fields are concatenated. Trailing whitespace on each
	 * line is trimmed. Lines are joined with `\n`.
	 *
	 * Width-0 cells (wide-character trailing halves) contribute nothing.
	 *
	 * If the screen is null or the selection is empty, no sequence is
	 * emitted.
	 */
	private copyToClipboard(): void {
		if (this.screen === null) return;

		const screen = this.screen;
		const minCol = Math.min(this.startCol, this.endCol);
		const maxCol = Math.max(this.startCol, this.endCol);
		const minRow = Math.min(this.startRow, this.endRow);
		const maxRow = Math.max(this.startRow, this.endRow);

		const lines: string[] = [];
		for (let y = minRow; y <= maxRow; y++) {
			if (y < 0 || y >= screen.height) continue;
			let line = "";
			for (let x = minCol; x <= maxCol; x++) {
				if (x < 0 || x >= screen.width) continue;
				const cell = screen.getCell(x, y);
				if (cell.width === 0) continue;
				line += cell.char;
			}
			lines.push(line.replace(/\s+$/, ""));
		}

		if (lines.length === 0) return;

		const text = lines.join("\n");
		const encoded = Buffer.from(text, "utf8").toString("base64");
		this.terminal.write(`\x1b]52;c;${encoded}\x07`);
	}
}
