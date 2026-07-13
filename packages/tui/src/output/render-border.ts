/**
 * Render-border — draw a box border onto an {@link Output}.
 *
 * Supports the 5 {@link BorderStyle}s defined in `dom/types.ts`:
 * `round`, `single`, `double`, `dashed`, `bold`. The character sets
 * mirror the `cli-boxes` npm package (Pi self-implements them to avoid
 * the external dependency).
 *
 * Each of the 4 sides can be individually hidden via `borderTop` /
 * `borderBottom` / `borderLeft` / `borderRight` (default: visible). The
 * border color is applied by interning a {@link TextStyles} with
 * `{ color: borderColor, dim: borderDimColor }` via the Output's
 * {@link Output.internStyle} method, so border characters carry the
 * same integer `styleId` the rest of the renderer uses.
 *
 * Reference: Claude Code `src/ink/render-border.ts` (229 lines, uses
 * `cli-boxes` + `chalk`).
 */

import type { BorderStyle, Color, TextStyles } from "../dom/types.ts";
import type { Output } from "./output.ts";

// --
// Border character sets
//
// Each style provides 8 characters: the 4 corners and the 4 edges.
// These match the `cli-boxes` package's named styles.

/**
 * Character set for one {@link BorderStyle}.
 */
interface BorderChars {
	readonly topLeft: string;
	readonly topRight: string;
	readonly bottomRight: string;
	readonly bottomLeft: string;
	readonly top: string;
	readonly bottom: string;
	readonly left: string;
	readonly right: string;
}

/**
 * The 5 supported border styles, keyed by {@link BorderStyle}.
 *
 * - `round`:  rounded corners (`╭╮╯╰`), used for default Ink boxes.
 * - `single`: sharp corners (`┌┐┘└`), standard light box-drawing.
 * - `double`: double-line (`╔╗╝╚`), for emphasis.
 * - `dashed`: dashed edges (`╌╎`) with blank corners, matching CC's
 *   `CUSTOM_BORDER_STYLES.dashed`.
 * - `bold`:   heavy/bold lines (`┏┓┛┗`).
 */
export const BORDER_STYLES: Record<BorderStyle, BorderChars> = {
	round: {
		topLeft: "\u256d",
		topRight: "\u256e",
		bottomRight: "\u256f",
		bottomLeft: "\u2570",
		top: "\u2500",
		bottom: "\u2500",
		left: "\u2502",
		right: "\u2502",
	},
	single: {
		topLeft: "\u250c",
		topRight: "\u2510",
		bottomRight: "\u2518",
		bottomLeft: "\u2514",
		top: "\u2500",
		bottom: "\u2500",
		left: "\u2502",
		right: "\u2502",
	},
	double: {
		topLeft: "\u2554",
		topRight: "\u2557",
		bottomRight: "\u255d",
		bottomLeft: "\u255a",
		top: "\u2550",
		bottom: "\u2550",
		left: "\u2551",
		right: "\u2551",
	},
	dashed: {
		// CC's CUSTOM_BORDER_STYLES.dashed uses spaces for corners
		// because there are no dashed corner characters in Unicode.
		topLeft: " ",
		topRight: " ",
		bottomRight: " ",
		bottomLeft: " ",
		top: "\u254c",
		bottom: "\u254c",
		left: "\u254e",
		right: "\u254e",
	},
	bold: {
		topLeft: "\u250f",
		topRight: "\u2513",
		bottomRight: "\u251b",
		bottomLeft: "\u2517",
		top: "\u2501",
		bottom: "\u2501",
		left: "\u2503",
		right: "\u2503",
	},
};

// --
// Options

/**
 * Per-side visibility and color options for {@link renderBorder}.
 */
export interface RenderBorderOptions {
	/** Show the top edge. Default: `true`. */
	readonly borderTop?: boolean;
	/** Show the bottom edge. Default: `true`. */
	readonly borderBottom?: boolean;
	/** Show the left edge. Default: `true`. */
	readonly borderLeft?: boolean;
	/** Show the right edge. Default: `true`. */
	readonly borderRight?: boolean;
	/** Foreground color for all border characters. */
	readonly borderColor?: Color;
	/** Dim the border color (SGR `dim`). */
	readonly borderDimColor?: boolean;
}

// --
// Public API

/**
 * Render a border of `width` × `height` at `(x, y)` onto `output`.
 *
 * The caller is responsible for having already computed the Yoga layout
 * and passing the node's absolute position and dimensions. Sides that
 * are hidden (via `borderTop: false`, etc.) are skipped entirely.
 *
 * Characters are written via {@link Output.writeText} with a `styleId`
 * interned from `{ color: borderColor, dim: borderDimColor }`. If
 * `borderColor` is unset, the border uses the default style (styleId 0).
 */
export function renderBorder(
	output: Output,
	x: number,
	y: number,
	width: number,
	height: number,
	style: BorderStyle,
	options: RenderBorderOptions = {},
): void {
	if (width <= 0 || height <= 0) return;

	const chars = BORDER_STYLES[style];
	const showTop = options.borderTop !== false;
	const showBottom = options.borderBottom !== false;
	const showLeft = options.borderLeft !== false;
	const showRight = options.borderRight !== false;

	// Intern the border's TextStyles → styleId.
	const borderTextStyle: TextStyles = {};
	if (options.borderColor !== undefined) {
		borderTextStyle.color = options.borderColor;
	}
	if (options.borderDimColor) {
		borderTextStyle.dim = true;
	}
	const styleId = output.internStyle(borderTextStyle);

	// Content width = total width minus left/right border columns.
	// Used for the top/bottom horizontal edge length.
	const contentWidth = Math.max(0, width - (showLeft ? 1 : 0) - (showRight ? 1 : 0));

	// --
	// Top border

	if (showTop) {
		const line = buildHorizontalBorder(chars.topLeft, chars.top, chars.topRight, contentWidth, showLeft, showRight);
		output.writeText(x, y, line, styleId);
	}

	// --
	// Side borders (left + right verticals)

	const sideStart = showTop ? 1 : 0;
	const sideEnd = showBottom ? height - 1 : height;
	for (let row = sideStart; row < sideEnd; row++) {
		const py = y + row;
		if (showLeft) {
			output.writeText(x, py, chars.left, styleId);
		}
		if (showRight) {
			output.writeText(x + width - 1, py, chars.right, styleId);
		}
	}

	// --
	// Bottom border

	if (showBottom) {
		const bottomY = y + height - 1;
		const line = buildHorizontalBorder(
			chars.bottomLeft,
			chars.bottom,
			chars.bottomRight,
			contentWidth,
			showLeft,
			showRight,
		);
		output.writeText(x, bottomY, line, styleId);
	}
}

// --
// Internal

/**
 * Build a horizontal border line from left corner, repeated edge char,
 * and right corner.
 *
 * If `contentWidth` is 0, the line is just the corners (or empty). The
 * Output's bounds checking handles any overflow (e.g. width=1 with both
 * corners present — the second corner lands out of bounds and is
 * silently dropped).
 */
function buildHorizontalBorder(
	leftCorner: string,
	edge: string,
	rightCorner: string,
	contentWidth: number,
	showLeft: boolean,
	showRight: boolean,
): string {
	let line = "";
	if (showLeft) line += leftCorner;
	for (let i = 0; i < contentWidth; i++) {
		line += edge;
	}
	if (showRight) line += rightCorner;
	return line;
}
