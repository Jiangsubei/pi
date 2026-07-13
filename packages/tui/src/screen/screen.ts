/**
 * Screen buffer.
 *
 * A {@link Screen} is a 2D grid of {@link Cell} values indexed by
 * `[row][col]` (i.e. `cells[y][x]`). It is the backing store the
 * renderer reads from during the paint pass and the basis for the
 * frame-to-frame diff the renderer emits to the terminal.
 *
 * P1 scope: extends the P0 minimal subset with shared pools
 * ({@link CharPool}, {@link StylePool}, {@link HyperlinkPool}) and
 * the blit / clip / fillRegion / clearRegion / shiftRows / diffEach
 * operations the Paint and Diff engines need. Cell still carries
 * `char: string` for backward compatibility with the P0 output and
 * log-update paths; the pools are available for resolution of
 * styleId / hyperlink IDs back to their payloads.
 *
 * Reference: src/ink/screen.ts (1486 lines, full version) — this file
 * mirrors the public API surface of the CC Screen, backed by a
 * Cell[][] grid instead of CC's packed Int32Array.
 */

import type { Cell } from "./cell.ts";
import { EMPTY_CELL } from "./cell.ts";
import { CharPool, HyperlinkPool, StylePool } from "./pool.ts";

// --
// Screen

/**
 * Optional pools to share across screens. When omitted, the
 * {@link Screen} constructor creates fresh instances. Pass the same
 * pool set to {@link clone}, {@link clip}, and {@link blit} targets so
 * interned IDs stay valid across screens — for the progressive P1
 * strategy, cells still hold `char: string` so the pools are advisory
 * rather than load-bearing, but the Paint and Diff engines read them
 * to resolve styleId / hyperlink IDs back to their payloads.
 */
export interface ScreenPools {
	charPool: CharPool;
	stylePool: StylePool;
	hyperlinkPool: HyperlinkPool;
}

/**
 * A 2D character buffer.
 *
 * The grid is row-major: `cells[y][x]` is the cell at column `x` of
 * row `y`. Width is the number of columns, height the number of rows.
 * Both are non-negative; a zero-dimension screen is valid and has an
 * empty `cells` array.
 *
 * Out-of-bounds reads return the shared {@link EMPTY_CELL} sentinel;
 * out-of-bounds writes are silently ignored. This keeps callers from
 * having to clamp every coordinate, at the cost of a bounds check per
 * access.
 *
 * The three pools ({@link charPool}, {@link stylePool},
 * {@link hyperlinkPool}) are shared across screens produced by
 * {@link clone} and {@link clip} so that interned IDs remain stable.
 * {@link blit} copies cells by value; if the source and destination
 * use different pool instances the styleId / hyperlink IDs carried by
 * the cells may not resolve in the destination — share pools when
 * blitting between independently-constructed screens.
 */
export class Screen {
	width: number;
	height: number;
	cells: Cell[][];
	readonly charPool: CharPool;
	readonly stylePool: StylePool;
	readonly hyperlinkPool: HyperlinkPool;

	/**
	 * Lazy row-hash cache for the diff fast path. `null` when the cache
	 * is invalid (any cell mutation clears it); allocated on the first
	 * {@link getRowHash} call after a stable state.
	 *
	 * Each entry is the djb2 hash of the row's cells
	 * (char code × length + width + styleId + hyperlink). Two rows with
	 * the same hash are assumed identical and skipped by the diff pass;
	 * a hash mismatch falls through to per-cell comparison. Collisions
	 * are possible but extremely rare for typical terminal content.
	 */
	private rowHashes: Int32Array | null = null;

	constructor(width: number, height: number, pools?: ScreenPools) {
		this.width = width;
		this.height = height;
		this.charPool = pools?.charPool ?? new CharPool();
		this.stylePool = pools?.stylePool ?? new StylePool();
		this.hyperlinkPool = pools?.hyperlinkPool ?? new HyperlinkPool();
		this.cells = Screen.createCells(width, height);
	}

	// --
	// Construction helpers

	/**
	 * Allocate a fresh `height × width` grid of {@link EMPTY_CELL}
	 * copies. Each cell is a distinct object so callers can mutate
	 * one without affecting its neighbors.
	 */
	private static createCells(width: number, height: number): Cell[][] {
		const rows: Cell[][] = [];
		for (let y = 0; y < height; y++) {
			rows.push(Screen.createEmptyRow(width));
		}
		return rows;
	}

	/**
	 * Allocate a single row of `width` fresh {@link EMPTY_CELL}
	 * copies. Used by {@link createCells} and {@link shiftRows} (the
	 * latter replaces vacated rows with fresh empty rows so prior
	 * cell references held outside the screen do not alias the
	 * cleared buffer).
	 */
	private static createEmptyRow(width: number): Cell[] {
		const row: Cell[] = [];
		for (let x = 0; x < width; x++) {
			row.push({ ...EMPTY_CELL });
		}
		return row;
	}

	// --
	// Single-cell access

	/**
	 * Return the cell at `(x, y)`. Out-of-bounds coordinates return the
	 * shared {@link EMPTY_CELL} sentinel — do not mutate the returned
	 * object. Use {@link setCell} to write.
	 */
	getCell(x: number, y: number): Cell {
		if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
			return EMPTY_CELL;
		}
		return this.cells[y][x];
	}

	/**
	 * Set the cell at `(x, y)` to `cell`. The reference is stored
	 * directly (no copy); callers that reuse a mutable `cell` object
	 * across positions must pass distinct copies. Out-of-bounds writes
	 * are ignored.
	 */
	setCell(x: number, y: number, cell: Cell): void {
		if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
			return;
		}
		this.cells[y][x] = cell;
		this.invalidateRowHashes();
	}

	// --
	// Rectangular operations

	/**
	 * Fill the rectangle `(x, y, w, h)` with `char` at `styleId`.
	 * Each filled cell is a fresh `{ char, width: 1, styleId }` object
	 * so cells stay independently mutable. Positions outside the
	 * screen are skipped; a zero or negative `w`/`h` is a no-op.
	 */
	fill(x: number, y: number, w: number, h: number, char: string, styleId: number): void {
		for (let dy = 0; dy < h; dy++) {
			const py = y + dy;
			if (py < 0 || py >= this.height) continue;
			const row = this.cells[py];
			for (let dx = 0; dx < w; dx++) {
				const px = x + dx;
				if (px < 0 || px >= this.width) continue;
				row[px] = { char, width: 1, styleId };
			}
		}
		this.invalidateRowHashes();
	}

	/**
	 * Reset every cell to a fresh {@link EMPTY_CELL} copy. Dimensions
	 * are unchanged. Allocates new cell objects so prior references
	 * held outside the screen do not alias the cleared buffer.
	 */
	clear(): void {
		for (let y = 0; y < this.height; y++) {
			const row = this.cells[y];
			for (let x = 0; x < this.width; x++) {
				row[x] = { ...EMPTY_CELL };
			}
		}
		this.invalidateRowHashes();
	}

	/**
	 * Resize to `width × height`, preserving overlapping content.
	 * Cells outside the old bounds are filled with {@link EMPTY_CELL};
	 * cells outside the new bounds are discarded. A no-op when the
	 * dimensions are unchanged.
	 */
	resize(width: number, height: number): void {
		if (width === this.width && height === this.height) {
			return;
		}
		const next: Cell[][] = [];
		for (let y = 0; y < height; y++) {
			const prevRow = y < this.cells.length ? this.cells[y] : undefined;
			const row: Cell[] = [];
			for (let x = 0; x < width; x++) {
				if (prevRow !== undefined && x < prevRow.length) {
					row.push(prevRow[x]);
				} else {
					row.push({ ...EMPTY_CELL });
				}
			}
			next.push(row);
		}
		this.cells = next;
		this.width = width;
		this.height = height;
		this.invalidateRowHashes();
	}

	// --
	// Text

	/**
	 * Write `text` starting at column `x` on row `y`, one cell per
	 * code point. Each cell gets `{ char, width: 1, styleId }`.
	 *
	 * P0 simplification: wide characters (CJK, emoji) are not handled
	 * — every code point takes exactly one cell regardless of its
	 * East Asian width. Wide-character-aware writes are deferred.
	 *
	 * Characters that fall before column 0 or past the right edge are
	 * skipped. If `y` is out of bounds the call is a no-op.
	 */
	writeText(x: number, y: number, text: string, styleId: number): void {
		if (y < 0 || y >= this.height) {
			return;
		}
		const row = this.cells[y];
		let px = x;
		for (const char of text) {
			if (px < 0) {
				px++;
				continue;
			}
			if (px >= this.width) {
				break;
			}
			row[px] = { char, width: 1, styleId };
			px++;
		}
		this.invalidateRowHashes();
	}

	// --
	// Whole-buffer operations

	/**
	 * Return a deep copy of this screen. Every cell is a fresh object
	 * (shallow copy of {@link Cell}, which suffices because `Cell`
	 * holds only primitives). Mutating the clone does not affect this
	 * screen and vice versa. The pools are shared (not cloned) so that
	 * interned IDs remain valid in the copy — pools are append-only
	 * dedup tables, sharing them is always safe.
	 */
	clone(): Screen {
		const copy = new Screen(this.width, this.height, {
			charPool: this.charPool,
			stylePool: this.stylePool,
			hyperlinkPool: this.hyperlinkPool,
		});
		for (let y = 0; y < this.height; y++) {
			const srcRow = this.cells[y];
			const dstRow = copy.cells[y];
			for (let x = 0; x < this.width; x++) {
				dstRow[x] = { ...srcRow[x] };
			}
		}
		return copy;
	}

	/**
	 * Return `true` iff `other` has the same dimensions and every
	 * cell matches (char, width, styleId, hyperlink). Screens of
	 * different sizes are never equal, even if one is a prefix of
	 * the other.
	 */
	equals(other: Screen): boolean {
		if (this.width !== other.width || this.height !== other.height) {
			return false;
		}
		for (let y = 0; y < this.height; y++) {
			const a = this.cells[y];
			const b = other.cells[y];
			for (let x = 0; x < this.width; x++) {
				const ca = a[x];
				const cb = b[x];
				if (
					ca.char !== cb.char ||
					ca.width !== cb.width ||
					ca.styleId !== cb.styleId ||
					ca.hyperlink !== cb.hyperlink
				) {
					return false;
				}
			}
		}
		return true;
	}

	/**
	 * Return the coordinates of every cell in this screen that differs
	 * from `other`. Cells outside this screen's bounds are not reported
	 * (diff is from this screen's perspective: "which of my cells
	 * changed?"). Out-of-bounds cells in `other` are read as
	 * {@link EMPTY_CELL} via {@link getCell}.
	 *
	 * The returned array is in row-major order (sorted by `y`, then
	 * `x`), which is the order the renderer emits output in.
	 */
	diff(other: Screen): Array<{ x: number; y: number }> {
		const result: Array<{ x: number; y: number }> = [];
		for (let y = 0; y < this.height; y++) {
			const row = this.cells[y];
			for (let x = 0; x < this.width; x++) {
				const a = row[x];
				const b = other.getCell(x, y);
				if (a.char !== b.char || a.width !== b.width || a.styleId !== b.styleId || a.hyperlink !== b.hyperlink) {
					result.push({ x, y });
				}
			}
		}
		return result;
	}

	// --
	// Region operations (P1)

	/**
	 * Copy the contents of `src` into this screen at offset
	 * `(dstX, dstY)`. Source cells that fall outside this screen's
	 * bounds are clipped. Each destination cell is a fresh shallow
	 * copy of the source cell — mutating the source after blit does
	 * not affect this screen and vice versa.
	 *
	 * Pools are NOT re-interned: cells carry their `styleId` and
	 * `hyperlink` IDs as-is. If `src` uses different pool instances
	 * than this screen, those IDs may not resolve correctly here.
	 * Share pools (via {@link ScreenPools}) when blitting between
	 * independently-constructed screens.
	 */
	blit(src: Screen, dstX: number, dstY: number): void {
		for (let sy = 0; sy < src.height; sy++) {
			const py = dstY + sy;
			if (py < 0 || py >= this.height) continue;
			const srcRow = src.cells[sy];
			const dstRow = this.cells[py];
			for (let sx = 0; sx < src.width; sx++) {
				const px = dstX + sx;
				if (px < 0 || px >= this.width) continue;
				dstRow[px] = { ...srcRow[sx] };
			}
		}
		this.invalidateRowHashes();
	}

	/**
	 * Return a new `w × h` screen containing a deep copy of the
	 * rectangular region `(x, y, w, h)` of this screen. Source
	 * positions outside this screen's bounds map to {@link EMPTY_CELL}
	 * in the result (the result is always `w × h`).
	 *
	 * The returned screen shares this screen's pools so interned IDs
	 * stay valid in the clip. This is the primary building block for
	 * the Paint engine's local rendering: paint into a clipped sub-screen,
	 * then {@link blit} it back to the parent.
	 */
	clip(x: number, y: number, w: number, h: number): Screen {
		const result = new Screen(w, h, {
			charPool: this.charPool,
			stylePool: this.stylePool,
			hyperlinkPool: this.hyperlinkPool,
		});
		for (let dy = 0; dy < h; dy++) {
			const sy = y + dy;
			if (sy < 0 || sy >= this.height) continue;
			const srcRow = this.cells[sy];
			const dstRow = result.cells[dy];
			for (let dx = 0; dx < w; dx++) {
				const sx = x + dx;
				if (sx < 0 || sx >= this.width) continue;
				dstRow[dx] = { ...srcRow[sx] };
			}
		}
		return result;
	}

	/**
	 * Fill the rectangle `(x, y, w, h)` with shallow copies of
	 * `cell` (default {@link EMPTY_CELL}). Each filled cell is a fresh
	 * object so cells stay independently mutable. Positions outside
	 * the screen are skipped; a zero or negative `w`/`h` is a no-op.
	 *
	 * Unlike {@link fill} (which takes a `char` string and a
	 * `styleId` number), `fillRegion` accepts a full {@link Cell} —
	 * useful for stamping a pre-built cell template (including width
	 * and hyperlink) across a region.
	 */
	fillRegion(x: number, y: number, w: number, h: number, cell: Cell = EMPTY_CELL): void {
		for (let dy = 0; dy < h; dy++) {
			const py = y + dy;
			if (py < 0 || py >= this.height) continue;
			const row = this.cells[py];
			for (let dx = 0; dx < w; dx++) {
				const px = x + dx;
				if (px < 0 || px >= this.width) continue;
				row[px] = { ...cell };
			}
		}
		this.invalidateRowHashes();
	}

	/**
	 * Reset every cell in the rectangle `(x, y, w, h)` to a fresh
	 * {@link EMPTY_CELL} copy. Equivalent to
	 * `fillRegion(x, y, w, h, EMPTY_CELL)` but clearer at call sites
	 * that semantically mean "clear" rather than "fill with a cell".
	 */
	clearRegion(x: number, y: number, w: number, h: number): void {
		this.fillRegion(x, y, w, h, EMPTY_CELL);
	}

	/**
	 * Shift the rows in the half-open range `[startRow, endRow)` by
	 * `delta` rows. `delta > 0` shifts UP (the row at `startRow + delta`
	 * moves to `startRow`); `delta < 0` shifts DOWN (the row at
	 * `startRow - delta` moves to `startRow + |delta|`). Vacated rows
	 * are replaced with fresh empty rows so prior cell references held
	 * outside the screen do not alias the cleared buffer.
	 *
	 * Rows outside `[startRow, endRow)` are untouched. `|delta|` >=
	 * the range height clears every row in the range. A zero `delta`
	 * or an empty range (`startRow >= endRow`) is a no-op.
	 *
	 * Used to implement DECSTBM scroll regions (CSI n S / CSI n T).
	 * Range is clamped to `[0, height)`; out-of-range `startRow` /
	 * `endRow` are silently adjusted.
	 */
	shiftRows(startRow: number, endRow: number, delta: number): void {
		if (delta === 0) return;
		const top = Math.max(0, startRow);
		const bottom = Math.min(this.height, endRow);
		if (top >= bottom) return;

		if (delta > 0) {
			// Shift up: row at y+n becomes row at y.
			const n = Math.min(delta, bottom - top);
			for (let y = top; y < bottom - n; y++) {
				this.cells[y] = this.cells[y + n];
			}
			for (let y = bottom - n; y < bottom; y++) {
				this.cells[y] = Screen.createEmptyRow(this.width);
			}
		} else {
			// Shift down: row at y-n becomes row at y.
			const n = Math.min(-delta, bottom - top);
			for (let y = bottom - 1; y >= top + n; y--) {
				this.cells[y] = this.cells[y - n];
			}
			for (let y = top; y < top + n; y++) {
				this.cells[y] = Screen.createEmptyRow(this.width);
			}
		}
		this.invalidateRowHashes();
	}

	// --
	// Per-cell diff with callback (P1)

	/**
	 * Iterate every cell position in the union of this screen's and
	 * `prev`'s bounds. For each position where the cells differ, call
	 * `callback(x, y, prevCell, curCell)`.
	 *
	 * - `prevCell` is the cell at `(x, y)` in `prev`, or `undefined`
	 *   if the position is outside `prev`'s bounds.
	 * - `curCell` is the cell at `(x, y)` in this screen, or
	 *   `undefined` if the position is outside this screen's bounds.
	 *
	 * For comparison, a position outside a screen's bounds is treated
	 * as {@link EMPTY_CELL}: if `prev` has an empty cell where `cur`
	 * is out of bounds, no callback fires (both render nothing). This
	 * matches the visual semantics of the diff — only cells that
	 * would produce different terminal output are reported.
	 *
	 * The callback may return a truthy value (e.g. `true`) to request
	 * early exit; this method then returns `true`. Otherwise returns
	 * `false`. Returning nothing (a `void` callback) continues
	 * iteration. The callback receives direct references into the cell
	 * arrays — do not mutate them.
	 *
	 * No temporary objects are allocated per cell: the hot path is
	 * just bounds checks and field reads. The callback is invoked
	 * only for differing cells, so its allocation cost is bounded by
	 * the number of changes.
	 */
	diffEach(
		prev: Screen,
		callback: (x: number, y: number, prevCell: Cell | undefined, curCell: Cell | undefined) => unknown,
	): boolean {
		const maxHeight = Math.max(this.height, prev.height);
		const maxWidth = Math.max(this.width, prev.width);
		for (let y = 0; y < maxHeight; y++) {
			const curRow = y < this.height ? this.cells[y] : undefined;
			const prevRow = y < prev.height ? prev.cells[y] : undefined;
			for (let x = 0; x < maxWidth; x++) {
				const curCell = curRow !== undefined && x < this.width ? curRow[x] : undefined;
				const prevCell = prevRow !== undefined && x < prev.width ? prevRow[x] : undefined;
				// Out-of-bounds reads as EMPTY_CELL for the equality
				// check so an empty cell in one screen matches a
				// missing cell in the other (both render nothing).
				const curEffective: Cell = curCell ?? EMPTY_CELL;
				const prevEffective: Cell = prevCell ?? EMPTY_CELL;
				if (cellsEqual(curEffective, prevEffective)) continue;
				if (callback(x, y, prevCell, curCell)) return true;
			}
		}
		return false;
	}

	/**
	 * Diff a single row `y` against `prev`'s row `y`. Same semantics as
	 * {@link diffEach} but scoped to one row — used by the renderer's
	 * row-skip fast path (compare row hashes first; on mismatch, fall
	 * through to per-cell diff via this method).
	 *
	 * The callback signature omits `y` (the caller already knows it).
	 * Returns `true` if the callback requested early exit, `false`
	 * otherwise.
	 */
	diffRow(
		prev: Screen,
		y: number,
		callback: (x: number, prevCell: Cell | undefined, curCell: Cell | undefined) => unknown,
	): boolean {
		const maxWidth = Math.max(this.width, prev.width);
		const curRow = y < this.height ? this.cells[y] : undefined;
		const prevRow = y < prev.height ? prev.cells[y] : undefined;
		for (let x = 0; x < maxWidth; x++) {
			const curCell = curRow !== undefined && x < this.width ? curRow[x] : undefined;
			const prevCell = prevRow !== undefined && x < prev.width ? prevRow[x] : undefined;
			const curEffective: Cell = curCell ?? EMPTY_CELL;
			const prevEffective: Cell = prevCell ?? EMPTY_CELL;
			if (cellsEqual(curEffective, prevEffective)) continue;
			if (callback(x, prevCell, curCell)) return true;
		}
		return false;
	}

	// --
	// Row-hash fast path (P5 Task 32.2)

	/**
	 * Return a 32-bit hash of row `y`'s cells. Two rows with identical
	 * cell content (char, width, styleId, hyperlink for every column)
	 * produce the same hash; a single cell difference changes the hash.
	 *
	 * The hash is computed lazily on first access and cached in
	 * {@link rowHashes}; any cell mutation invalidates the cache via
	 * {@link invalidateRowHashes}. This makes repeated reads cheap —
	 * the diff pass calls `getRowHash(y)` for every row, and the
	 * prev screen's hashes persist across frames (the prev screen is
	 * stable between renders).
	 *
	 * Out-of-bounds `y` returns 0 (the empty-row hash).
	 *
	 * Collision handling: the diff pass treats hash equality as "rows
	 * are identical" and skips the per-cell comparison. Collisions are
	 * possible but extremely rare for typical terminal content (djb2
	 * over ~200 cells per row). The previous per-cell diff is the
	 * fallback when hashes mismatch.
	 */
	getRowHash(y: number): number {
		if (y < 0 || y >= this.height) return 0;
		if (this.rowHashes === null) {
			this.rowHashes = this.computeAllRowHashes();
		}
		return this.rowHashes[y];
	}

	/**
	 * Mark the row-hash cache as stale. Called by every cell-mutating
	 * method ({@link setCell}, {@link fill}, {@link clear}, etc.).
	 * The next {@link getRowHash} call reallocates and recomputes the
	 * full cache. This is O(width × height) on the first read after a
	 * mutation, but the result is cached for subsequent reads until
	 * the next mutation.
	 */
	private invalidateRowHashes(): void {
		this.rowHashes = null;
	}

	/**
	 * Compute the djb2-derived hash for every row in one pass. Used
	 * internally by {@link getRowHash} on first access after a stable
	 * state.
	 *
	 * The hash mixes `char.charCodeAt(i)` for every code unit in
	 * `cell.char`, plus `cell.width`, `cell.styleId`, and
	 * `cell.hyperlink`. `Math.imul` provides 32-bit multiplication;
	 * the `| 0` coerces back to Int32 range.
	 */
	private computeAllRowHashes(): Int32Array {
		const hashes = new Int32Array(this.height);
		for (let y = 0; y < this.height; y++) {
			let hash = 5381;
			const row = this.cells[y];
			for (let x = 0; x < this.width; x++) {
				const cell = row[x];
				const charLen = cell.char.length;
				for (let i = 0; i < charLen; i++) {
					hash = (Math.imul(hash, 33) ^ cell.char.charCodeAt(i)) | 0;
				}
				hash = (Math.imul(hash, 33) ^ charLen) | 0;
				hash = (Math.imul(hash, 33) ^ cell.width) | 0;
				hash = (Math.imul(hash, 33) ^ cell.styleId) | 0;
				hash = (Math.imul(hash, 33) ^ (cell.hyperlink ?? 0)) | 0;
			}
			hashes[y] = hash;
		}
		return hashes;
	}
}

// --
// Helpers

/**
 * Compare two cells by value. `undefined` arguments are treated as
 * {@link EMPTY_CELL} by callers; this function only handles the
 * defined-defined case. Both arguments being the same reference (or
 * both `undefined`) short-circuits to `true`.
 */
function cellsEqual(a: Cell | undefined, b: Cell | undefined): boolean {
	if (a === b) return true;
	if (a === undefined || b === undefined) return false;
	return a.char === b.char && a.width === b.width && a.styleId === b.styleId && a.hyperlink === b.hyperlink;
}
