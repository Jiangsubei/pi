/**
 * Colorize — convert structured {@link Color} / {@link TextStyles} values
 * to ANSI escape sequences.
 *
 * This module is the Pi equivalent of Claude Code's `src/ink/colorize.ts`.
 * Unlike CC (which delegates to `chalk`), Pi generates the SGR sequences
 * directly so there is no runtime dependency on `chalk`. The supported
 * color formats mirror the {@link Color} union in `dom/types.ts`:
 *
 * - `rgb(r,g,b)`     → `\x1b[38;2;r;g;bm` (fg) / `\x1b[48;2;r;g;bm` (bg)
 * - `#RRGGBB`/`#RGB` → expanded to 24-bit and emitted as above
 * - `ansi256(n)`     → `\x1b[38;5;nm` (fg) / `\x1b[48;5;nm` (bg)
 * - `ansi:name`      → standard 16-color SGR (`\x1b[3Xm` / `\x1b[4Xm`)
 *                       or bright variant (`\x1b[9Xm` / `\x1b[10Xm`)
 *
 * The {@link applyTextStyles} function composes a full SGR prefix from a
 * {@link TextStyles} object, suitable for emitting before a run of
 * characters that share the same style.
 *
 * Reference: Claude Code `src/ink/colorize.ts` (231 lines).
 */

import type { Color, TextStyles } from "../dom/types.ts";

// --
// Regexes for parsing the color string formats

const RGB_REGEX = /^rgb\(\s?(\d+),\s?(\d+),\s?(\d+)\s?\)$/;
const ANSI256_REGEX = /^ansi256\(\s?(\d+)\s?\)$/;
const HEX_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// --
// ANSI color name → base SGR code (0-7)
//
// The 8 base ANSI colors map to SGR codes 30-37 (fg) / 40-47 (bg).
// The bright variants map to 90-97 (fg) / 100-107 (bg).

const ANSI_COLOR_CODES: Record<string, number> = {
	black: 0,
	red: 1,
	green: 2,
	yellow: 3,
	blue: 4,
	magenta: 5,
	cyan: 6,
	white: 7,
};

// --
// Color parsing helpers

/**
 * Parse a `#RGB` or `#RRGGBB` hex string into `{r, g, b}`.
 * Returns `undefined` for malformed input.
 */
function parseHex(hex: string): { r: number; g: number; b: number } | undefined {
	const match = HEX_REGEX.exec(hex);
	if (match === null) return undefined;
	const digits = match[1]!;
	if (digits.length === 3) {
		// #RGB → #RRGGBB (each digit doubled)
		const r = Number.parseInt(digits[0]! + digits[0]!, 16);
		const g = Number.parseInt(digits[1]! + digits[1]!, 16);
		const b = Number.parseInt(digits[2]! + digits[2]!, 16);
		return { r, g, b };
	}
	const r = Number.parseInt(digits.slice(0, 2), 16);
	const g = Number.parseInt(digits.slice(2, 4), 16);
	const b = Number.parseInt(digits.slice(4, 6), 16);
	return { r, g, b };
}

/**
 * Parse an `ansi:name` color into its SGR parameter.
 * Returns `undefined` for unrecognized names.
 *
 * - `ansi:red`       → `{ code: 1, bright: false }` → fg `\x1b[31m`
 * - `ansi:redBright` → `{ code: 1, bright: true }`  → fg `\x1b[91m`
 */
function parseAnsiName(name: string): { code: number; bright: boolean } | undefined {
	const brightSuffix = "Bright";
	if (name.endsWith(brightSuffix)) {
		const base = name.slice(0, -brightSuffix.length);
		const code = ANSI_COLOR_CODES[base];
		if (code === undefined) return undefined;
		return { code, bright: true };
	}
	const code = ANSI_COLOR_CODES[name];
	if (code === undefined) return undefined;
	return { code, bright: false };
}

// --
// Public API

/**
 * The SGR "select" parameter for foreground (38) or background (48).
 * Used to build the multi-parameter SGR sequence for RGB / 256-color.
 */
const FG_SELECT = 38;
const BG_SELECT = 48;

/**
 * Convert a {@link Color} to the ANSI foreground escape sequence.
 * Returns the empty string for unrecognized formats.
 *
 * - `rgb(255,0,0)`   → `\x1b[38;2;255;0;0m`
 * - `#ff0000`        → `\x1b[38;2;255;0;0m`
 * - `#f00`           → `\x1b[38;2;255;0;0m`
 * - `ansi256(196)`   → `\x1b[38;5;196m`
 * - `ansi:red`       → `\x1b[31m`
 * - `ansi:redBright` → `\x1b[91m`
 */
export function colorizeFg(color: Color): string {
	return colorize(color, FG_SELECT);
}

/**
 * Convert a {@link Color} to the ANSI background escape sequence.
 * Returns the empty string for unrecognized formats.
 *
 * - `rgb(255,0,0)`   → `\x1b[48;2;255;0;0m`
 * - `#ff0000`        → `\x1b[48;2;255;0;0m`
 * - `ansi256(196)`   → `\x1b[48;5;196m`
 * - `ansi:red`       → `\x1b[41m`
 * - `ansi:redBright` → `\x1b[101m`
 */
export function colorizeBg(color: Color): string {
	return colorize(color, BG_SELECT);
}

/**
 * Full SGR reset: `\x1b[0m`. Clears all attributes (color, bold, etc.).
 */
export function colorizeReset(): string {
	return "\x1b[0m";
}

/**
 * Build a full SGR prefix from a {@link TextStyles} object.
 *
 * The sequence orders background last so it wraps the foreground and
 * text modifiers (matching chalk's nesting order). An empty
 * {@link TextStyles} produces the empty string.
 *
 * Example: `{ color: "ansi:red", bold: true }` →
 * `"\x1b[1m\x1b[31m"` (bold then red fg).
 */
export function applyTextStyles(style: TextStyles): string {
	let s = "";
	// Text modifiers first (innermost), then foreground, then background.
	if (style.bold) s += "\x1b[1m";
	if (style.dim) s += "\x1b[2m";
	if (style.italic) s += "\x1b[3m";
	if (style.underline) s += "\x1b[4m";
	if (style.strikethrough) s += "\x1b[9m";
	if (style.inverse) s += "\x1b[7m";
	if (style.color) s += colorizeFg(style.color);
	if (style.backgroundColor) s += colorizeBg(style.backgroundColor);
	return s;
}

// --
// Internal

/**
 * Core color → SGR converter. `select` is 38 (fg) or 48 (bg).
 */
function colorize(color: Color, select: number): string {
	// ansi:name — 16-color SGR
	if (color.startsWith("ansi:")) {
		const name = color.substring("ansi:".length);
		const parsed = parseAnsiName(name);
		if (parsed === undefined) return "";
		// fg: 30+code (normal) or 90+code (bright)
		// bg: 40+code (normal) or 100+code (bright)
		const base = select === FG_SELECT ? 30 : 40;
		const offset = parsed.bright ? 60 : 0;
		return `\x1b[${base + offset + parsed.code}m`;
	}

	// #RRGGBB / #RGB — 24-bit truecolor
	if (color.startsWith("#")) {
		const rgb = parseHex(color);
		if (rgb === undefined) return "";
		return `\x1b[${select};2;${rgb.r};${rgb.g};${rgb.b}m`;
	}

	// ansi256(n) — 256-color palette
	if (color.startsWith("ansi256")) {
		const match = ANSI256_REGEX.exec(color);
		if (match === null) return "";
		const n = Number(match[1]);
		return `\x1b[${select};5;${n}m`;
	}

	// rgb(r,g,b) — 24-bit truecolor
	if (color.startsWith("rgb")) {
		const match = RGB_REGEX.exec(color);
		if (match === null) return "";
		const r = Number(match[1]);
		const g = Number(match[2]);
		const b = Number(match[3]);
		return `\x1b[${select};2;${r};${g};${b}m`;
	}

	return "";
}
