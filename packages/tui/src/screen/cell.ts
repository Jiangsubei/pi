/**
 * Minimal cell types for the screen buffer.
 *
 * A cell is a single character position on the screen. It carries the
 * character (which may be one half of a wide character), its display
 * width, a style-pool ID, and an optional hyperlink-pool ID.
 *
 * The {@link CellStyle} fields are pooled separately by the renderer;
 * cells only hold the integer `styleId` so a screen buffer of N×M cells
 * stays compact (one object per cell, no nested style objects).
 *
 * Reference: src/ink/screen.ts (1486 lines, full version) — this file
 * is the minimal subset enumerated by the P0 task spec.
 */

// --
// CellStyle

/**
 * Visual style for a cell. `fg`/`bg` are color IDs (or RGB-encoded
 * numbers) resolved by the renderer's color pool; the remaining flags
 * map directly to SGR attributes. Two styles are equal iff every field
 * matches, which is what the {@link StylePool} relies on for dedup.
 */
export interface CellStyle {
	fg: number;
	bg: number;
	bold: boolean;
	dim: boolean;
	italic: boolean;
	underline: boolean;
	strikethrough: boolean;
	inverse: boolean;
}

// --
// Cell

/**
 * A single position on the screen.
 *
 * - `char`: the character to display. For a wide character (e.g. CJK),
 *   the first cell holds the character with `width: 2` and the second
 *   cell holds {@link WIDE_CELL_PLACEHOLDER} with `width: 0`.
 * - `width`: 0 (wide-character trailing half, renders nothing, cursor
 *   does not advance), 1 (normal), or 2 (wide-character leading half).
 * - `styleId`: index into the renderer's {@link StylePool}; 0 is the
 *   default style (no attributes, default colors).
 * - `hyperlink`: optional index into the renderer's hyperlink pool;
 *   omitted when the cell has no hyperlink.
 */
export interface Cell {
	char: string;
	width: number;
	styleId: number;
	hyperlink?: number;
}

// --
// Shared constants

/**
 * A blank cell: single-width space, default style, no hyperlink.
 *
 * Returned by {@link Screen.getCell} for out-of-bounds coordinates.
 * Callers must not mutate the returned object — treat it as a frozen
 * sentinel. The screen buffer copies it on write.
 */
export const EMPTY_CELL: Cell = {
	char: " ",
	width: 1,
	styleId: 0,
};

/**
 * Placeholder for the trailing half of a wide character.
 *
 * `width: 0` tells the renderer to skip this cell (the cursor already
 * advanced by 2 when the leading half was drawn). `char` is empty
 * because nothing is rendered here.
 */
export const WIDE_CELL_PLACEHOLDER: Cell = {
	char: "",
	width: 0,
	styleId: 0,
};
