/**
 * SGR (Select Graphic Rendition) state machine for legacy ANSI bridge.
 *
 * {@link AnsiStateTracker} tracks SGR attribute state across a sequence
 * of ANSI escape codes and exposes the current state as a
 * {@link TextStyles} object. The bridge paint pass
 * ({@link renderLegacy}) uses this to convert component-emitted ANSI
 * into per-segment {@link TextStyles}, which the new engine's
 * {@link StylePool} interns into `styleId`s so the diff layer emits
 * correct SGR transitions on style changes.
 *
 * ## Initialization with inherited state
 *
 * The tracker is constructed with the {@link TextStyles} inherited from
 * ancestor `ink-box` nodes. This mirrors the terminal's cumulative SGR
 * model: the ancestor sets a base state, and the component's SGR codes
 * modify it. Crucially, when the component emits `\x1b[0m` (reset),
 * the tracker returns to the terminal default (all attributes
 * cleared), which correctly clears attributes inherited from ancestors
 * — matching how the terminal would render the same stream.
 *
 * ## Supported SGR codes
 *
 * - Reset: `0`
 * - Bold: `1` (on) / `22` (off, also clears dim)
 * - Dim: `2` (on) / `22` (off, also clears bold)
 * - Italic: `3` (on) / `23` (off)
 * - Underline: `4` (on) / `24` (off)
 * - Inverse: `7` (on) / `27` (off)
 * - Strikethrough: `9` (on) / `29` (off)
 * - Foreground: `30-37`, `90-97`, `38;5;N`, `38;2;R;G;B`, `39` (default)
 * - Background: `40-47`, `100-107`, `48;5;N`, `48;2;R;G;B`, `49` (default)
 *
 * Unsupported codes are ignored, matching the legacy TUI behavior
 * (legacy just emits the raw ANSI to the terminal, which also ignores
 * unknown codes).
 *
 * ## Color mapping
 *
 * SGR 30-37 / 90-97 map to {@link AnsiColor} tokens (`ansi:red`, etc.)
 * because the terminal interprets these through its palette. 256-color
 * and RGB codes map to {@link Ansi256Color} / {@link RGBColor} so the
 * exact color is preserved.
 *
 * ## Reference
 *
 * Claude Code's `ink-raw-ansi` path parses SGR sequences into a
 * similar state machine in `src/ink/ansi-state.ts`. Pi's version is
 * simpler — it only tracks the fields {@link TextStyles} supports.
 */

import type { AnsiColor, Color, TextStyles } from "../dom/types.ts";
import { extractAnsiCode } from "../utils.ts";

// --
// Constants

/** ANSI 16-color name table indexed by SGR base code 0-7. */
const ANSI_COLOR_NAMES: readonly AnsiColor[] = [
	"ansi:black",
	"ansi:red",
	"ansi:green",
	"ansi:yellow",
	"ansi:blue",
	"ansi:magenta",
	"ansi:cyan",
	"ansi:white",
];

const ANSI_BRIGHT_COLOR_NAMES: readonly AnsiColor[] = [
	"ansi:blackBright",
	"ansi:redBright",
	"ansi:greenBright",
	"ansi:yellowBright",
	"ansi:blueBright",
	"ansi:magentaBright",
	"ansi:cyanBright",
	"ansi:whiteBright",
];

// --
// State

/**
 * Mutable SGR state tracker. Initialize with {@link AnsiStateTracker.fromInherited}
 * so the component's SGR codes layer on top of ancestor styles, then
 * call {@link process} for each escape and {@link toTextStyles} to
 * snapshot the current state for a text segment.
 */
export class AnsiStateTracker {
	private bold: boolean;
	private dim: boolean;
	private italic: boolean;
	private underline: boolean;
	private inverse: boolean;
	private strikethrough: boolean;
	private fgColor: Color | undefined;
	private bgColor: Color | undefined;

	private constructor(initial: TextStyles) {
		this.bold = initial.bold ?? false;
		this.dim = initial.dim ?? false;
		this.italic = initial.italic ?? false;
		this.underline = initial.underline ?? false;
		this.inverse = initial.inverse ?? false;
		this.strikethrough = initial.strikethrough ?? false;
		this.fgColor = initial.color;
		this.bgColor = initial.backgroundColor;
	}

	/**
	 * Construct a tracker seeded with the inherited {@link TextStyles}
	 * from ancestor `ink-box` nodes. Subsequent SGR codes processed via
	 * {@link process} modify this state, and {@link toTextStyles}
	 * snapshots the current state for each text segment.
	 */
	static fromInherited(initial: TextStyles = {}): AnsiStateTracker {
		return new AnsiStateTracker(initial);
	}

	/** Reset all SGR state to terminal defaults (no attributes). */
	private resetToDefault(): void {
		this.bold = false;
		this.dim = false;
		this.italic = false;
		this.underline = false;
		this.inverse = false;
		this.strikethrough = false;
		this.fgColor = undefined;
		this.bgColor = undefined;
	}

	/** Apply one ANSI escape sequence (CSI/OSC/APC) to the state. */
	process(ansiCode: string): void {
		// Only SGR sequences (CSI ending in 'm') affect state.
		const match = /\x1b\[([\d;]*)m/.exec(ansiCode);
		if (match === null) return;

		const params = match[1]!;
		if (params === "") {
			// `\x1b[m` is equivalent to `\x1b[0m` (full reset).
			this.resetToDefault();
			return;
		}

		const parts = params.split(";");
		let i = 0;
		while (i < parts.length) {
			const code = Number.parseInt(parts[i] ?? "", 10);
			if (Number.isNaN(code)) {
				i++;
				continue;
			}

			// Extended color: 38 (fg) / 48 (bg) followed by 5;N or 2;R;G;B.
			if (code === 38 || code === 48) {
				const mode = parts[i + 1];
				if (mode === "5") {
					const n = Number.parseInt(parts[i + 2] ?? "", 10);
					if (!Number.isNaN(n)) {
						const color: Color = `ansi256(${n})`;
						if (code === 38) this.fgColor = color;
						else this.bgColor = color;
					}
					i += 3;
					continue;
				}
				if (mode === "2") {
					const r = Number.parseInt(parts[i + 2] ?? "", 10);
					const g = Number.parseInt(parts[i + 3] ?? "", 10);
					const b = Number.parseInt(parts[i + 4] ?? "", 10);
					if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
						const color: Color = `rgb(${r},${g},${b})`;
						if (code === 38) this.fgColor = color;
						else this.bgColor = color;
					}
					i += 5;
					continue;
				}
				// Malformed 38/48 — skip the leading code only.
				i++;
				continue;
			}

			switch (code) {
				case 0:
					this.resetToDefault();
					break;
				case 1:
					this.bold = true;
					break;
				case 2:
					this.dim = true;
					break;
				case 3:
					this.italic = true;
					break;
				case 4:
					this.underline = true;
					break;
				case 7:
					this.inverse = true;
					break;
				case 9:
					this.strikethrough = true;
					break;
				case 22:
					this.bold = false;
					this.dim = false;
					break;
				case 23:
					this.italic = false;
					break;
				case 24:
					this.underline = false;
					break;
				case 27:
					this.inverse = false;
					break;
				case 29:
					this.strikethrough = false;
					break;
				case 39:
					this.fgColor = undefined;
					break;
				case 49:
					this.bgColor = undefined;
					break;
				default:
					if (code >= 30 && code <= 37) {
						this.fgColor = ANSI_COLOR_NAMES[code - 30];
					} else if (code >= 90 && code <= 97) {
						this.fgColor = ANSI_BRIGHT_COLOR_NAMES[code - 90];
					} else if (code >= 40 && code <= 47) {
						this.bgColor = ANSI_COLOR_NAMES[code - 40];
					} else if (code >= 100 && code <= 107) {
						this.bgColor = ANSI_BRIGHT_COLOR_NAMES[code - 100];
					}
					// Unsupported codes (blink, conceal, font, etc.) are ignored.
					break;
			}
			i++;
		}
	}

	/**
	 * Snapshot the current SGR state as a {@link TextStyles} object.
	 *
	 * Returns the full state (including `false` values for unset
	 * attributes) so that a component-emitted reset (`\x1b[0m`)
	 * correctly clears attributes inherited from ancestor `ink-box`
	 * nodes. The {@link StylePool} dedups by JSON equality, so the
	 * slight overhead of explicit `false` fields is bounded by the
	 * number of distinct style combinations actually used.
	 */
	toTextStyles(): TextStyles {
		return {
			bold: this.bold,
			dim: this.dim,
			italic: this.italic,
			underline: this.underline,
			inverse: this.inverse,
			strikethrough: this.strikethrough,
			color: this.fgColor,
			backgroundColor: this.bgColor,
		};
	}
}

// --
// Segmentation

/** A run of text with consistent SGR state. */
export interface StyledSegment {
	text: string;
	style: TextStyles;
}

/**
 * Walk `line` and split it into {@link StyledSegment}s.
 *
 * Each ANSI escape encountered updates the tracker state; the text
 * between escapes becomes a segment carrying the current style
 * snapshot. Empty text runs (back-to-back escapes) are skipped. The
 * returned segments can be fed to {@link Output.writeText} with the
 * matching `styleId` for each, so the diff layer emits proper SGR
 * transitions on style changes.
 *
 * `extractAnsiCode` recognizes CSI, OSC, and APC sequences. OSC 8
 * hyperlinks (URL escapes) don't affect SGR state, so they pass
 * through the tracker as no-ops while still being stripped from the
 * visible text — this matches the legacy TUI behavior of letting the
 * terminal handle hyperlink rendering natively.
 */
export function parseAnsiSegments(line: string, tracker: AnsiStateTracker): StyledSegment[] {
	const segments: StyledSegment[] = [];
	let i = 0;
	let textStart = 0;
	while (i < line.length) {
		const ansi = extractAnsiCode(line, i);
		if (ansi === null) {
			i++;
			continue;
		}
		// Flush text accumulated before this escape as one segment.
		if (i > textStart) {
			segments.push({ text: line.slice(textStart, i), style: tracker.toTextStyles() });
		}
		tracker.process(ansi.code);
		i += ansi.length;
		textStart = i;
	}
	// Flush trailing text.
	if (textStart < line.length) {
		segments.push({ text: line.slice(textStart), style: tracker.toTextStyles() });
	}
	return segments;
}
