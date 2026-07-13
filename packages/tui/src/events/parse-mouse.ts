/**
 * SGR mouse sequence parser (P4 Task 27).
 *
 * Parses the SGR-1006 mouse format emitted by terminals when DECSET
 * 1006 is active (enabled by {@link Terminal.enableMouseMode}):
 *
 *   `\x1b[<button;col;rowM`  press / motion (button held)
 *   `\x1b[<button;col;rowm`  release
 *
 * `button` packs the button code, modifier flags, and event-type bits:
 *   bit 0-1  button code (0=left, 1=middle, 2=right, 3=other)
 *   bit 2    (4)   shift
 *   bit 3    (8)   alt/meta
 *   bit 4    (16)  ctrl
 *   bit 5    (32)  motion flag (drag while button held)
 *   bit 6    (64)  wheel event flag (button code 0=up, 1=down)
 *
 * `col` and `row` are 1-based terminal coordinates and are converted
 * to 0-based by the parser.
 *
 * The returned {@link MouseEvent} has `target = null`; the caller is
 * expected to run {@link hitTest} and assign `event.target` before
 * dispatching.
 *
 * Reference: https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h3-Extended-coordinates
 */

import { MouseEvent } from "./synthetic-event.ts";

// Bit masks for the SGR button parameter.
const BUTTON_CODE_MASK = 0b11; // bits 0-1
const SHIFT_BIT = 4; // bit 2
const ALT_BIT = 8; // bit 3
const CTRL_BIT = 16; // bit 4
const MOTION_BIT = 32; // bit 5
const WHEEL_BIT = 64; // bit 6: wheel event flag (button code 0=up, 1=down)

// Matches the SGR-1006 mouse format: \x1b[<button;col;rowM (press/motion)
// or \x1b[<button;col;rowm (release). Note: NO semicolon between row and
// the trailing M/m — the row parameter is immediately followed by the
// event-type byte. (Prior version erroneously required a 3rd semicolon,
// which only matched malformed test fixtures, never real terminal output.)
const SGR_MOUSE_REGEX = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/;

/**
 * Parse an SGR-1006 mouse sequence into a {@link MouseEvent}.
 *
 * @returns A {@link MouseEvent} with `target = null`, or `null` if the
 *          input does not match the SGR format.
 */
export function parseMouseSequence(data: string): MouseEvent | null {
	const match = data.match(SGR_MOUSE_REGEX);
	if (match === null) return null;

	const rawButton = Number.parseInt(match[1]!, 10);
	const col1Based = Number.parseInt(match[2]!, 10);
	const row1Based = Number.parseInt(match[3]!, 10);
	const isRelease = match[4] === "m";

	// Modifier flags
	const shiftKey = (rawButton & SHIFT_BIT) !== 0;
	const altKey = (rawButton & ALT_BIT) !== 0;
	const ctrlKey = (rawButton & CTRL_BIT) !== 0;

	// Convert 1-based terminal coordinates to 0-based.
	const col = col1Based - 1;
	const row = row1Based - 1;

	// Determine event type and button/deltaY.
	const isWheel = (rawButton & WHEEL_BIT) !== 0;
	const isMotion = (rawButton & MOTION_BIT) !== 0;
	const buttonCode = rawButton & BUTTON_CODE_MASK;

	if (isWheel) {
		// Button code 0 = wheel up (deltaY -1), 1 = wheel down (deltaY +1).
		return new MouseEvent(null, {
			button: buttonCode,
			col,
			row,
			shiftKey,
			altKey,
			ctrlKey,
			type: "mousewheel",
			deltaY: buttonCode === 1 ? 1 : -1,
		});
	}

	if (isMotion) {
		return new MouseEvent(null, {
			button: buttonCode,
			col,
			row,
			shiftKey,
			altKey,
			ctrlKey,
			type: "mousemove",
		});
	}

	return new MouseEvent(null, {
		button: buttonCode,
		col,
		row,
		shiftKey,
		altKey,
		ctrlKey,
		type: isRelease ? "mouseup" : "mousedown",
	});
}
