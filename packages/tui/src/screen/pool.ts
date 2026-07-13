/**
 * Shared pools for interning styles, characters, and hyperlinks.
 *
 * Each pool deduplicates its inputs by content equality and returns a
 * stable integer ID. The ID is valid for the lifetime of the pool and
 * can be stored compactly in a {@link Cell} instead of the full style /
 * character / hyperlink payload.
 *
 * Progressive strategy (P1): these pools are standalone classes held
 * by {@link Screen} as instance references. {@link Cell} keeps its
 * `char: string` field for backward compatibility with the P0
 * output / log-update paths; the pools are available for the Paint
 * engine and the Diff engine to resolve IDs back to their payloads.
 * A later step may switch {@link Cell} to store `charId: number`
 * instead of `char: string`, at which point every cell write goes
 * through {@link CharPool.add}.
 *
 * Reference: Claude Code `src/ink/screen.ts` (StylePool, CharPool,
 * HyperlinkPool — full version uses packed Int32Array cells and
 * AnsiCode[]-based styles; this file uses the simpler TextStyles /
 * string / HyperlinkEntry model that matches the Pi DOM types).
 */

import type { TextStyles } from "../dom/types.ts";

// --
// HyperlinkEntry

/**
 * A hyperlink entry stored in {@link HyperlinkPool}.
 *
 * - `uri`: the OSC 8 hyperlink target URI.
 * - `id`: the optional OSC 8 `id` parameter. Two links with the same
 *   `id` are treated as a single link by the terminal (the hovered one
 *   is underlined, others are not). Different `id`s produce distinct
 *   link spans even when the URI is identical.
 */
export interface HyperlinkEntry {
	uri: string;
	id?: string;
}

// --
// CharPool

/**
 * Character string pool for deduplicating frequently-used characters.
 *
 * With a shared pool, interned char IDs are valid across any screen
 * that uses the same pool instance. This saves memory when many cells
 * share the same character (e.g. `" "`, `"│"`, `"─"`): instead of
 * storing a string per cell, each cell stores a small integer index.
 *
 * Index 0 is reserved for the empty string (sentinel for "no
 * character"); the first user-supplied character receives ID 1.
 *
 * Reference: CC `CharPool` interns every character through an ASCII
 * fast-path (`Int32Array[128]` keyed by charCode) plus a `Map` for
 * non-ASCII. This implementation uses a single `Map` for simplicity —
 * the ASCII fast-path is a P2 optimization once {@link Cell} switches
 * to `charId: number`.
 */
export class CharPool {
	private nextId: number = 1;
	private readonly chars: Map<string, number> = new Map();
	private readonly idToChar: string[] = [""];

	/**
	 * Wall-clock timestamp (ms since epoch) of the most recent
	 * {@link add} call. Used by {@link maybeReset} to detect idle
	 * periods for generational GC (P5 Task 32.4).
	 */
	private lastAddTimestamp: number = Date.now();

	/**
	 * Intern `char` and return its ID. If the character was already
	 * interned, returns the existing ID (deduplication). Otherwise
	 * assigns a new ID and stores the character.
	 */
	add(char: string): number {
		let id = this.chars.get(char);
		if (id === undefined) {
			id = this.nextId;
			this.nextId++;
			this.chars.set(char, id);
			this.idToChar[id] = char;
		}
		this.lastAddTimestamp = Date.now();
		return id;
	}

	/**
	 * Return the character for `id`, or `undefined` if the ID is not
	 * in the pool. Index 0 returns the empty string.
	 */
	get(id: number): string | undefined {
		return this.idToChar[id];
	}

	/**
	 * Reset the pool to its initial state. All interned IDs become
	 * invalid; the pool is ready to accept new characters. Index 0
	 * (the empty-string sentinel) is preserved.
	 */
	clear(): void {
		this.nextId = 1;
		this.chars.clear();
		this.idToChar.length = 1;
		this.idToChar[0] = "";
		this.lastAddTimestamp = Date.now();
	}

	/**
	 * P5 Task 32.4: generational GC entry point.
	 *
	 * Checks whether the pool has been idle for >= 5 minutes (no
	 * {@link add} calls) and, if so, would compact the ID space and
	 * rebuild the `id → char` mapping to reclaim IDs whose characters
	 * are no longer referenced by any cell.
	 *
	 * CURRENT IMPLEMENTATION: detects the idle condition but does not
	 * perform the reset. A correct implementation requires scanning
	 * all live cells across all retained screens (prev + cur) to find
	 * which IDs are still in use, rebuilding the dedup table with only
	 * those entries, and rewriting every cell's `charId` to the new
	 * compacted value. This is risky because:
	 *   1. The renderer's prevScreen holds cells with old IDs.
	 *   2. The LogUpdate styleCache is keyed by styleId (for
	 *      StylePool) — a reset would invalidate it.
	 *   3. The current per-frame pool lifecycle (fresh pool per
	 *      Screen in {@link createRenderer}) means stale IDs never
	 *      accumulate, so the GC is not needed in practice.
	 *
	 * Deferred until cell storage migrates to packed Int32Array and
	 * pools become shared across frames.
	 */
	maybeReset(): void {
		const idleMs = Date.now() - this.lastAddTimestamp;
		const FIVE_MINUTES_MS = 5 * 60 * 1000;
		if (idleMs < FIVE_MINUTES_MS) return;
		// TODO(P5): implement generational GC when pools are shared
		// across frames. The per-frame lifecycle currently makes this
		// a no-op — pools are discarded with each Screen.
	}
}

// --
// StylePool

/**
 * Style pool for deduplicating {@link TextStyles} objects.
 *
 * Index 0 is reserved for "no style" (the default); the first
 * user-supplied style receives ID 1. Two styles with identical fields
 * return the same ID — the pool uses JSON serialization as the dedup
 * key, which is simple but effective for the small, flat TextStyles
 * shape.
 *
 * Reference: CC `StylePool` interns `AnsiCode[]` arrays and packs a
 * "visible on space" bit into bit 0 of the ID. This implementation
 * uses the higher-level {@link TextStyles} model that the Pi DOM layer
 * already produces; the SGR-sequence-level interning is a P2 concern
 * once the renderer emits real SGR sequences.
 */
export class StylePool {
	private nextId: number = 1;
	private readonly styles: Map<string, number> = new Map();
	private readonly idToStyle: TextStyles[] = [];

	/**
	 * Wall-clock timestamp (ms since epoch) of the most recent
	 * {@link add} call. Used by {@link maybeReset} to detect idle
	 * periods for generational GC (P5 Task 32.4).
	 */
	private lastAddTimestamp: number = Date.now();

	/**
	 * Intern `style` and return its ID. If an identical style was
	 * already interned (per JSON equality of its TextStyles fields),
	 * returns the existing ID. Otherwise assigns a new ID and stores
	 * the style.
	 */
	add(style: TextStyles): number {
		const key = JSON.stringify(style);
		let id = this.styles.get(key);
		if (id === undefined) {
			id = this.nextId;
			this.nextId++;
			this.styles.set(key, id);
			this.idToStyle[id] = style;
		}
		this.lastAddTimestamp = Date.now();
		return id;
	}

	/**
	 * Return the style for `id`, or `undefined` if the ID is not in
	 * the pool.
	 */
	get(id: number): TextStyles | undefined {
		return this.idToStyle[id];
	}

	/**
	 * Reset the pool to its initial state.
	 */
	clear(): void {
		this.nextId = 1;
		this.styles.clear();
		this.idToStyle.length = 0;
		this.lastAddTimestamp = Date.now();
	}

	/**
	 * P5 Task 32.4: generational GC entry point.
	 *
	 * Checks whether the pool has been idle for >= 5 minutes (no
	 * {@link add} calls) and, if so, would compact the ID space and
	 * rebuild the `id → style` mapping to reclaim IDs whose styles
	 * are no longer referenced by any cell.
	 *
	 * CURRENT IMPLEMENTATION: detects the idle condition but does not
	 * perform the reset. A correct implementation requires scanning
	 * all live cells across all retained screens (prev + cur) to find
	 * which styleIds are still in use, rebuilding the dedup table with
	 * only those entries, and rewriting every cell's `styleId` to the
	 * new compacted value. This is risky because:
	 *   1. The renderer's prevScreen holds cells with old styleIds.
	 *   2. The LogUpdate styleCache is keyed by styleId — a reset
	 *      would invalidate it.
	 *   3. The current per-frame pool lifecycle (fresh pool per
	 *      Screen in {@link createRenderer}) means stale styleIds
	 *      never accumulate, so the GC is not needed in practice.
	 *
	 * Deferred until cell storage migrates to packed Int32Array and
	 * pools become shared across frames.
	 */
	maybeReset(): void {
		const idleMs = Date.now() - this.lastAddTimestamp;
		const FIVE_MINUTES_MS = 5 * 60 * 1000;
		if (idleMs < FIVE_MINUTES_MS) return;
		// TODO(P5): implement generational GC when pools are shared
		// across frames. The per-frame lifecycle currently makes this
		// a no-op — pools are discarded with each Screen.
	}
}

// --
// HyperlinkPool

/**
 * Hyperlink pool for deduplicating OSC 8 hyperlink entries.
 *
 * Index 0 is reserved for "no hyperlink". Each entry carries a URI
 * and an optional `id` (the OSC 8 `id` parameter). Two entries with
 * the same URI and id return the same pool ID.
 */
export class HyperlinkPool {
	private nextId: number = 1;
	private readonly links: Map<string, number> = new Map();
	private readonly idToLink: HyperlinkEntry[] = [];

	/**
	 * Intern `link` and return its ID. If an identical link (same URI
	 * and id) was already interned, returns the existing ID. Otherwise
	 * assigns a new ID and stores the link.
	 */
	add(link: HyperlinkEntry): number {
		const key = `${link.id ?? ""}\0${link.uri}`;
		let id = this.links.get(key);
		if (id === undefined) {
			id = this.nextId;
			this.nextId++;
			this.links.set(key, id);
			this.idToLink[id] = link;
		}
		return id;
	}

	/**
	 * Return the link for `id`, or `undefined` if the ID is not in
	 * the pool.
	 */
	get(id: number): HyperlinkEntry | undefined {
		return this.idToLink[id];
	}

	/**
	 * Reset the pool to its initial state.
	 */
	clear(): void {
		this.nextId = 1;
		this.links.clear();
		this.idToLink.length = 0;
	}
}
