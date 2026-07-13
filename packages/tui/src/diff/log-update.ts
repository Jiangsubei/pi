/**
 * LogUpdate — frame-to-frame diff engine that emits ANSI output sequences.
 *
 * The renderer produces a {@link Screen} per frame. {@link LogUpdate.render}
 * compares the new frame against the previous one (or, on the first call,
 * emits a full repaint) and returns the ANSI string the caller should write
 * to the terminal.
 *
 * All output is wrapped in synchronized-update guards (CSI 2026:
 * `\x1b[?2026h` ... `\x1b[?2026l`) so the terminal applies the update
 * atomically without flicker.
 *
 * P1 scope (full version):
 *   - BSU/ESU wrapping (CSI 2026).
 *   - Full SGR via {@link applyTextStyles}: on a `styleId` change the
 *     engine emits `\x1b[0m` (reset) followed by the full SGR prefix for
 *     the new style, resolved through the current Screen's
 *     {@link StylePool}. A per-instance {@link styleCache} avoids
 *     re-running `applyTextStyles` for the same `styleId` across calls
 *     that share the same pool.
 *   - Damage region merging: changed cells in the same row with
 *     consecutive x coordinates are merged into a single cursor-move +
 *     multi-character write, reducing the number of CUP sequences.
 *   - DECSTBM hardware scroll hint: when the prev→cur transition is a
 *     pure vertical shift (content scrolled up by N rows), the engine
 *     emits a DECSTBM sequence (`\x1b[top;bottom r` + `\x1b[NS` +
 *     `\x1b[r`) to shift the terminal's scroll region, then renders only
 *     the newly scrolled-in rows. The prev screen is `shiftRows`-ed to
 *     simulate the scroll so the diff pass only finds the new rows.
 *   - Wide-character handling: `width=0` trailing halves are skipped
 *     (cursor already advanced past them when the leading half was
 *     written). `width=2` leading halves advance the cursor by 2.
 *   - Double-buffering: the caller passes the prev Screen (or `null` on
 *     the first frame); the LogUpdate instance is stateless across
 *     frames except for the style cache.
 *
 * Reference: src/ink/log-update.ts (CC full version, 773 lines) — this
 * file mirrors the public API and behavior but drops CC's VirtualScreen
 * cursor tracking, scrollback/cursor-restore handling, and debug logging
 * (Pi's terminal abstraction handles those concerns).
 */

import type { TextStyles } from "../dom/types.ts";
import { applyHighlight, type HighlightPredicate } from "../highlight.ts";
import { applyTextStyles } from "../output/colorize.ts";
import type { Cell } from "../screen/cell.ts";
import type { StylePool } from "../screen/pool.ts";
import type { Screen } from "../screen/screen.ts";

// --
// ANSI constants

/** Begin synchronized update — wraps every frame so the terminal applies it atomically. */
const BSU = "\x1b[?2026h";
/** End synchronized update. */
const ESU = "\x1b[?2026l";
/** Home cursor to (0, 0). Used at the start of a first-frame full repaint. */
const HOME = "\x1b[H";
/** Clear screen + home cursor. Used when dimensions change (stale cells need clearing). */
const CLEAR_SCREEN = "\x1b[2J\x1b[H";
/** Reset all SGR attributes to the terminal default. */
const RESET_STYLE = "\x1b[0m";
/** Reset scroll region (DECSTBM with no parameters — full screen). */
const RESET_SCROLL_REGION = "\x1b[r";

// --
// LogUpdate

/**
 * Frame diff engine. Emits ANSI sequences that transform the terminal
 * from the previous frame to the current one.
 *
 * Usage:
 * 1. Construct once.
 * 2. Call {@link render} with the previous frame (or `null` on the first
 *    call) and the current frame; write the returned string to the
 *    terminal.
 * 3. The caller is responsible for retaining the current frame to pass
 *    as `prev` on the next call (double-buffering).
 */
export class LogUpdate {
	/**
	 * Cache of `styleId → ANSI SGR prefix` (the result of
	 * {@link applyTextStyles}). Keyed by styleId so the same style is
	 * not re-colorized across cells or frames.
	 *
	 * The cache is invalidated when the {@link StylePool} instance
	 * changes (different pool → different styleId → style mapping).
	 * In practice, screens produced by {@link Screen.clone} share the
	 * same pool, so the cache persists across frames in a
	 * double-buffered renderer.
	 */
	private readonly styleCache: Map<number, string> = new Map();

	/**
	 * The StylePool the cache was built against. When a render call
	 * receives a Screen whose pool differs, the cache is cleared and
	 * rebuilt against the new pool.
	 */
	private cachedStylePool: StylePool | null = null;

	/**
	 * Compare `cur` against `prev` and return the ANSI sequence that
	 * updates the terminal. The sequence is wrapped in BSU/ESU guards.
	 *
	 * - If `prev` is `null` (first frame), emit a full repaint: home
	 *   cursor + write every cell + reset style.
	 * - If `prev` and `cur` have different dimensions, emit a clear
	 *   screen + full repaint (stale cells outside the new bounds would
	 *   otherwise linger).
	 * - Otherwise, try DECSTBM scroll detection. If the transition is a
	 *   pure upward vertical shift, emit the DECSTBM scroll sequence and
	 *   render only the newly scrolled-in rows.
	 * - If no scroll is detected, emit incremental diff output: only
	 *   cells that differ from `prev` are written, grouped into damage
	 *   regions (consecutive x in the same row) to minimize cursor moves.
	 *
	 * If `highlight` is provided, it is applied to `cur` (mutating
	 * styleIds for highlighted cells) before the diff pass so that
	 * highlight changes are detected as style changes. The caller should
	 * retain the (mutated) `cur` as `prev` for the next call so the
	 * diff state stays consistent.
	 *
	 * `dirtyYRanges`, when provided, limits the diff to the specified
	 * half-open `[start, end)` y-intervals. Rows outside these ranges
	 * are skipped entirely (no hash computation, no per-cell diff).
	 * This is the dirty-subtree optimization (P5 Task 32.3): the
	 * renderer collects yoga rects of dirty subtree roots and passes
	 * their y-spans here so the diff pass only scans rows that actually
	 * changed. When `dirtyYRanges` is `undefined`, the diff scans all
	 * rows (falling back to the row-hash fast path to skip unchanged
	 * rows). When scroll is detected, `dirtyYRanges` is ignored (the
	 * scroll path already limits the diff to newly scrolled-in rows).
	 *
	 * The caller must retain `cur` to pass as `prev` on the next call.
	 */
	render(
		prev: Screen | null,
		cur: Screen,
		highlight?: HighlightPredicate,
		dirtyYRanges?: ReadonlyArray<readonly [number, number]>,
	): string {
		if (highlight !== undefined) {
			applyHighlight(cur, highlight);
		}
		let body: string;
		if (prev === null) {
			body = this.renderFullFrame(cur, false);
		} else if (prev.width !== cur.width || prev.height !== cur.height) {
			body = this.renderFullFrame(cur, true);
		} else {
			body = this.renderDiff(prev, cur, dirtyYRanges);
		}
		return BSU + body + ESU;
	}

	// --
	// Full repaint

	/**
	 * Emit a full repaint of `frame`.
	 *
	 * - If `clearScreen` is true (dimension change), emit
	 *   {@link CLEAR_SCREEN} (`\x1b[2J\x1b[H`) to wipe stale content.
	 *   Otherwise emit {@link HOME} (`\x1b[H`) to just position the
	 *   cursor at (0, 0) — the first frame has nothing to clear.
	 * - Walk every cell in row-major order, skipping `width=0` trailing
	 *   halves. The cursor advances naturally within a row; at the start
	 *   of each subsequent row a CUP sequence repositions it to (0, y)
	 *   so a wide character at the right edge does not cause an implicit
	 *   wrap and desync subsequent rows.
	 * - Style transitions emit `\x1b[0m` (reset) + the full SGR prefix
	 *   for the new style, resolved through the frame's {@link StylePool}
	 *   and cached for subsequent cells with the same `styleId`.
	 * - A trailing `\x1b[0m` reset is appended so the terminal is left
	 *   in the default style.
	 */
	private renderFullFrame(frame: Screen, clearScreen: boolean): string {
		let output = clearScreen ? CLEAR_SCREEN : HOME;
		let lastStyleId = 0;
		let wroteCells = false;
		for (let y = 0; y < frame.height; y++) {
			if (y > 0) {
				output += this.moveCursor(0, y);
			}
			for (let x = 0; x < frame.width; x++) {
				const cell = frame.getCell(x, y);
				if (cell.width === 0) {
					continue;
				}
				output += this.styleTransition(cell.styleId, lastStyleId, frame.stylePool);
				output += cell.char;
				lastStyleId = cell.styleId;
				wroteCells = true;
			}
		}
		if (wroteCells) {
			output += RESET_STYLE;
		}
		return output;
	}

	// --
	// Incremental diff with damage region merging

	/**
	 * Emit only the cells in `cur` that differ from `prev`.
	 *
	 * The method first tries {@link detectScroll}: if the transition is
	 * a pure upward vertical shift by `delta` rows, it emits the DECSTBM
	 * scroll sequence and applies {@link Screen.shiftRows} to a clone of
	 * `prev` so the subsequent diff pass only discovers the newly
	 * scrolled-in rows.
	 *
	 * For non-scroll transitions, the diff walks every cell via
	 * {@link Screen.diffEach}. Changed cells are grouped into "damage
	 * regions": runs of consecutive x positions in the same row. Each
	 * run is emitted as a single cursor-positioning sequence followed by
	 * the characters of all cells in the run, which is cheaper than one
	 * CUP per cell. Consecutiveness is determined by cursor advance:
	 * after writing a cell of width W at column X, the cursor is at
	 * X+W; the next cell is consecutive iff its x equals X+W.
	 *
	 * `width=0` cells (wide-character trailing halves) are skipped —
	 * they produce no output and do not advance the cursor. They do not
	 * break a run either: a `width=2` cell at X followed by a `width=0`
	 * cell at X+1 (skipped) followed by a changed cell at X+2 is still
	 * consecutive, because the cursor landed at X+2 after the
	 * `width=2` write.
	 *
	 * Style transitions within a run emit `\x1b[0m` + the full SGR
	 * prefix. A trailing `\x1b[0m` reset is appended if any cells were
	 * written. If no cells changed and no scroll was emitted, the body
	 * is empty (just BSU + ESU).
	 *
	 * `dirtyYRanges` (P5 Task 32.2/32.3) limits the diff to the
	 * specified half-open `[start, end)` y-intervals. Rows outside
	 * these ranges are skipped entirely — no hash computation, no
	 * per-cell diff. When `dirtyYRanges` is omitted or empty, the
	 * diff scans all rows `[0, cur.height)` and relies on the row-hash
	 * fast path ({@link Screen.getRowHash}) to skip unchanged rows.
	 *
	 * When a DECSTBM scroll is detected, `dirtyYRanges` is ignored:
	 * the scroll path already restricts the diff to the newly
	 * scrolled-in rows (via {@link Screen.shiftRows} on a clone of
	 * `prev`). The row-hash fast path is still applied within the
	 * post-scroll scan, so matching rows (the upper portion that
	 * shifted in from below) are skipped.
	 *
	 * Row-hash fast path: for each scanned row, the djb2-derived
	 * hash of `prev`'s row is compared to `cur`'s row hash. Equal
	 * hashes skip the row entirely (the rows are identical). A hash
	 * mismatch falls through to per-cell comparison via
	 * {@link Screen.diffRow}. Hash collisions are possible but
	 * extremely rare for typical terminal content; the previous
	 * per-cell diff is the fallback on mismatch.
	 */
	private renderDiff(prev: Screen, cur: Screen, dirtyYRanges?: ReadonlyArray<readonly [number, number]>): string {
		// Try DECSTBM scroll detection.
		const scroll = this.detectScroll(prev, cur);
		let scrollSeq = "";
		let workPrev = prev;
		if (scroll !== null) {
			const delta = scroll;
			// Full-screen scroll region: top=1, bottom=height (1-indexed).
			scrollSeq = this.setScrollRegion(1, cur.height) + this.csiScrollUp(delta) + RESET_SCROLL_REGION;
			// Simulate the scroll on a clone of prev so the diff pass
			// only finds the newly scrolled-in rows.
			workPrev = prev.clone();
			workPrev.shiftRows(0, cur.height, delta);
		}

		// Determine which y-ranges to scan. When a scroll was detected
		// the dirtyYRanges hint is ignored (the scroll path already
		// restricts the diff via shiftRows). When no hint is provided,
		// fall back to scanning all rows; the row-hash fast path will
		// skip rows that did not change.
		let yRanges: ReadonlyArray<readonly [number, number]>;
		if (scroll !== null || dirtyYRanges === undefined || dirtyYRanges.length === 0) {
			yRanges = [[0, cur.height]];
		} else {
			yRanges = dirtyYRanges;
		}

		let output = scrollSeq;
		let lastStyleId = 0;
		let wroteCells = false;

		// Damage region merging: build runs of consecutive changed
		// cells within each row. The run is flushed when a gap is
		// encountered (non-consecutive x) or when the row changes.
		let currentRun: Cell[] = [];
		let runStartX = -1;
		let runY = -1;
		let expectedX = -1;

		const flushRun = (): void => {
			if (currentRun.length === 0) {
				return;
			}
			output += this.moveCursor(runStartX, runY);
			for (const cell of currentRun) {
				output += this.styleTransition(cell.styleId, lastStyleId, cur.stylePool);
				output += cell.char;
				lastStyleId = cell.styleId;
			}
			wroteCells = true;
			currentRun = [];
		};

		// Per-row scan with row-hash fast path. For each row, compare
		// the prev row hash to the cur row hash; equal hashes skip the
		// per-cell scan entirely. On mismatch, fall through to diffRow.
		for (const [yStart, yEnd] of yRanges) {
			const lo = Math.max(0, yStart);
			const hi = Math.min(cur.height, yEnd);
			for (let y = lo; y < hi; y++) {
				if (workPrev.getRowHash(y) === cur.getRowHash(y)) {
					continue;
				}
				cur.diffRow(workPrev, y, (x, _prevCell, curCell) => {
					// Skip cells that are out of bounds in cur or are
					// width=0 trailing halves (no output, no cursor advance).
					if (curCell === undefined) {
						return;
					}
					if (curCell.width === 0) {
						return;
					}

					// If the row changed or x is not consecutive with the
					// current run, flush the run before starting a new one.
					if (currentRun.length > 0 && (runY !== y || x !== expectedX)) {
						flushRun();
					}

					if (currentRun.length === 0) {
						runStartX = x;
						runY = y;
					}
					currentRun.push(curCell);
					expectedX = x + curCell.width;
				});
			}
		}
		flushRun();

		if (wroteCells) {
			output += RESET_STYLE;
		}
		return output;
	}

	// --
	// DECSTBM scroll detection

	/**
	 * Detect whether the `prev → cur` transition is a pure upward
	 * vertical scroll (content shifted up by `delta` rows).
	 *
	 * A scroll up by `delta` means:
	 * - `cur[y]` equals `prev[y + delta]` for all `y` in
	 *   `[0, height - delta)` — the visible content that was at
	 *   `y + delta` in prev is now at `y` in cur.
	 * - At least one row in `[height - delta, height)` (the newly
	 *   scrolled-in rows) differs from the corresponding row in prev —
	 *   otherwise prev and cur are identical and there is nothing to
	 *   scroll.
	 *
	 * Returns the scroll delta (a positive integer) if detected, or
	 * `null` if no scroll relationship holds. Only upward scrolls are
	 * detected; downward scrolls are rare in TUI usage and fall back
	 * to the normal diff path.
	 *
	 * Only full-screen scrolls are detected (scroll region = entire
	 * screen). Partial scroll regions would require a scrollHint from
	 * the caller (e.g. a ScrollBox component tracking its scrollTop),
	 * which is a P3 concern.
	 */
	private detectScroll(prev: Screen, cur: Screen): number | null {
		// Need at least 2 rows for a scroll to make sense.
		if (cur.height < 2) {
			return null;
		}
		for (let delta = 1; delta < cur.height; delta++) {
			if (this.isUpwardScroll(prev, cur, delta)) {
				return delta;
			}
		}
		return null;
	}

	/**
	 * Check whether `cur` is `prev` scrolled up by `delta` rows.
	 *
	 * Row equality is a full per-cell comparison (char, width, styleId,
	 * hyperlink). The check verifies that the overlapping region
	 * (`cur[0..height-delta)` == `prev[delta..height)`) matches AND that
	 * at least one of the newly scrolled-in rows
	 * (`cur[height-delta..height)`) actually differs from the
	 * corresponding row in prev — so that an identical prev/cur pair
	 * does not trigger a spurious scroll.
	 */
	private isUpwardScroll(prev: Screen, cur: Screen, delta: number): boolean {
		const matchCount = cur.height - delta;
		if (matchCount <= 0) {
			return false;
		}
		// Overlapping region must match.
		for (let y = 0; y < matchCount; y++) {
			if (!this.rowsEqual(prev, y + delta, cur, y)) {
				return false;
			}
		}
		// At least one new row must differ from prev.
		let hasNewContent = false;
		for (let y = matchCount; y < cur.height; y++) {
			if (!this.rowsEqual(prev, y, cur, y)) {
				hasNewContent = true;
				break;
			}
		}
		return hasNewContent;
	}

	/**
	 * Compare row `ay` of screen `a` with row `by` of screen `b`,
	 * cell by cell (char, width, styleId, hyperlink). Returns `true`
	 * iff all cells match. Used by {@link isUpwardScroll} to detect
	 * vertical scroll relationships.
	 */
	private rowsEqual(a: Screen, ay: number, b: Screen, by: number): boolean {
		const width = Math.min(a.width, b.width);
		for (let x = 0; x < width; x++) {
			const ca = a.getCell(x, ay);
			const cb = b.getCell(x, by);
			if (
				ca.char !== cb.char ||
				ca.width !== cb.width ||
				ca.styleId !== cb.styleId ||
				ca.hyperlink !== cb.hyperlink
			) {
				return false;
			}
		}
		// If widths differ, the remaining cells must all be empty in
		// the wider screen (otherwise it's not a match).
		if (a.width > b.width) {
			for (let x = width; x < a.width; x++) {
				const ca = a.getCell(x, ay);
				if (ca.char !== " " || ca.width !== 1 || ca.styleId !== 0) {
					return false;
				}
			}
		} else if (b.width > a.width) {
			for (let x = width; x < b.width; x++) {
				const cb = b.getCell(x, by);
				if (cb.char !== " " || cb.width !== 1 || cb.styleId !== 0) {
					return false;
				}
			}
		}
		return true;
	}

	// --
	// Style helpers

	/**
	 * Return the ANSI transition from `lastStyleId` to `newStyleId`.
	 *
	 * If the styleIds are equal, no transition is needed (empty string).
	 * Otherwise, emit `\x1b[0m` (reset) to clear the old style, followed
	 * by the full SGR prefix for the new style (resolved through
	 * {@link getStyleAnsi}).
	 *
	 * The reset is always emitted on a style change, even when
	 * transitioning to styleId 0 (default), because the terminal may
	 * have accumulated SGR state from a previous frame that we need to
	 * clear. Transitioning to styleId 0 emits just `\x1b[0m` (reset +
	 * empty SGR prefix).
	 */
	private styleTransition(newStyleId: number, lastStyleId: number, pool: StylePool): string {
		if (newStyleId === lastStyleId) {
			return "";
		}
		return RESET_STYLE + this.getStyleAnsi(newStyleId, pool);
	}

	/**
	 * Resolve `styleId` to its ANSI SGR prefix via the StylePool and
	 * cache the result.
	 *
	 * - `styleId 0` is the default style (no attributes): returns the
	 *   empty string.
	 * - Other IDs are resolved through `pool.get(styleId)`. If the pool
	 *   does not contain the ID (should not happen in practice), the
	 *   empty TextStyles `{}` is used as a fallback.
	 *
	 * The cache is keyed by `styleId` and invalidated when the pool
	 * instance changes (screens with different pools have different
	 * styleId → style mappings).
	 */
	private getStyleAnsi(styleId: number, pool: StylePool): string {
		if (pool !== this.cachedStylePool) {
			this.styleCache.clear();
			this.cachedStylePool = pool;
		}
		const cached = this.styleCache.get(styleId);
		if (cached !== undefined) {
			return cached;
		}
		const style: TextStyles = styleId === 0 ? {} : (pool.get(styleId) ?? {});
		const ansi = applyTextStyles(style);
		this.styleCache.set(styleId, ansi);
		return ansi;
	}

	// --
	// ANSI sequence helpers

	/**
	 * Return the ANSI CUP (cursor position) sequence for column `x`,
	 * row `y` (0-indexed): `\x1b[<y+1>;<x+1>H`.
	 */
	private moveCursor(x: number, y: number): string {
		return `\x1b[${y + 1};${x + 1}H`;
	}

	/**
	 * Set the terminal scroll region (DECSTBM) to rows `top`..`bottom`
	 * (1-indexed, inclusive): `\x1b[<top>;<bottom>r`.
	 *
	 * After this, scroll-up/scroll-down sequences (CSI n S / CSI n T)
	 * only affect the region between `top` and `bottom`.
	 */
	private setScrollRegion(top: number, bottom: number): string {
		return `\x1b[${top};${bottom}r`;
	}

	/**
	 * Scroll the terminal content up by `n` lines within the current
	 * scroll region (CSI n S): `\x1b[<n>S`.
	 *
	 * Lines scrolled off the top of the region are lost; new blank
	 * lines appear at the bottom.
	 */
	private csiScrollUp(n: number): string {
		return `\x1b[${n}S`;
	}
}
