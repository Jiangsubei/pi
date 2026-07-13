import assert from "node:assert";
import { describe, it } from "node:test";
import { CharPool, type HyperlinkEntry, HyperlinkPool, StylePool } from "../src/screen/pool.ts";
import { Screen } from "../src/screen/screen.ts";

// --
// StylePool tests

describe("StylePool", () => {
	it("deduplicates identical styles", () => {
		const pool = new StylePool();
		const id1 = pool.add({ color: "ansi:red" });
		const id2 = pool.add({ color: "ansi:red" });
		assert.strictEqual(id1, id2);
	});

	it("assigns different IDs to different styles", () => {
		const pool = new StylePool();
		const id1 = pool.add({ color: "ansi:red" });
		const id2 = pool.add({ color: "ansi:blue" });
		assert.notStrictEqual(id1, id2);
	});

	it("distinguishes by every TextStyles field", () => {
		const pool = new StylePool();
		const ids = [
			pool.add({ color: "ansi:red" }),
			pool.add({ color: "ansi:red", bold: true }),
			pool.add({ color: "ansi:red", italic: true }),
			pool.add({ color: "ansi:red", backgroundColor: "ansi:blue" }),
			pool.add({ color: "ansi:red", underline: true }),
			pool.add({ color: "ansi:red", strikethrough: true }),
			pool.add({ color: "ansi:red", dim: true }),
			pool.add({ color: "ansi:red", inverse: true }),
		];
		// All IDs distinct — no two TextStyles are equal.
		const unique = new Set(ids);
		assert.strictEqual(unique.size, ids.length);
	});

	it("retrieves a style by ID", () => {
		const pool = new StylePool();
		const id = pool.add({ color: "ansi:green", bold: true });
		const style = pool.get(id);
		assert.deepStrictEqual(style, { color: "ansi:green", bold: true });
	});

	it("returns undefined for an unknown ID", () => {
		const pool = new StylePool();
		assert.strictEqual(pool.get(999), undefined);
	});

	it("clear() resets the pool", () => {
		const pool = new StylePool();
		pool.add({ color: "ansi:red" });
		pool.clear();
		// After clear, the pool is empty: get returns undefined.
		assert.strictEqual(pool.get(1), undefined);
		// And re-adding starts from ID 1 again.
		const id = pool.add({ color: "ansi:blue" });
		assert.strictEqual(id, 1);
	});
});

// --
// CharPool tests

describe("CharPool", () => {
	it("deduplicates identical characters", () => {
		const pool = new CharPool();
		const id1 = pool.add("│");
		const id2 = pool.add("│");
		assert.strictEqual(id1, id2);
	});

	it("assigns different IDs to different characters", () => {
		const pool = new CharPool();
		const id1 = pool.add("│");
		const id2 = pool.add("─");
		assert.notStrictEqual(id1, id2);
	});

	it("retrieves a character by ID", () => {
		const pool = new CharPool();
		const id = pool.add("X");
		assert.strictEqual(pool.get(id), "X");
	});

	it("handles multi-codepoint graphemes", () => {
		const pool = new CharPool();
		// Family emoji with ZWJ — a single grapheme cluster of multiple codepoints.
		const id = pool.add("👨‍👩‍👧");
		assert.strictEqual(pool.get(id), "👨‍👩‍👧");
	});

	it("clear() resets the pool", () => {
		const pool = new CharPool();
		pool.add("A");
		pool.clear();
		assert.strictEqual(pool.get(1), undefined);
		const id = pool.add("B");
		assert.strictEqual(id, 1);
	});
});

// --
// HyperlinkPool tests

describe("HyperlinkPool", () => {
	it("deduplicates identical hyperlinks", () => {
		const pool = new HyperlinkPool();
		const entry: HyperlinkEntry = { uri: "https://example.com" };
		const id1 = pool.add(entry);
		const id2 = pool.add(entry);
		assert.strictEqual(id1, id2);
	});

	it("distinguishes hyperlinks by id parameter", () => {
		const pool = new HyperlinkPool();
		const id1 = pool.add({ uri: "https://example.com", id: "a" });
		const id2 = pool.add({ uri: "https://example.com", id: "b" });
		assert.notStrictEqual(id1, id2);
	});

	it("distinguishes hyperlinks by uri", () => {
		const pool = new HyperlinkPool();
		const id1 = pool.add({ uri: "https://example.com" });
		const id2 = pool.add({ uri: "https://other.com" });
		assert.notStrictEqual(id1, id2);
	});

	it("retrieves a hyperlink by ID", () => {
		const pool = new HyperlinkPool();
		const id = pool.add({ uri: "https://example.com", id: "x" });
		const entry = pool.get(id);
		assert.strictEqual(entry?.uri, "https://example.com");
		assert.strictEqual(entry?.id, "x");
	});

	it("clear() resets the pool", () => {
		const pool = new HyperlinkPool();
		pool.add({ uri: "https://example.com" });
		pool.clear();
		assert.strictEqual(pool.get(1), undefined);
		const id = pool.add({ uri: "https://other.com" });
		assert.strictEqual(id, 1);
	});
});

// --
// Screen.blit tests

describe("Screen.blit", () => {
	it("copies src content into dst at the specified position", () => {
		const dst = new Screen(10, 10);
		const src = new Screen(3, 2);
		src.writeText(0, 0, "ABC", 0);
		src.writeText(0, 1, "DEF", 0);
		dst.blit(src, 2, 3);
		assert.strictEqual(dst.getCell(2, 3).char, "A");
		assert.strictEqual(dst.getCell(3, 3).char, "B");
		assert.strictEqual(dst.getCell(4, 3).char, "C");
		assert.strictEqual(dst.getCell(2, 4).char, "D");
		assert.strictEqual(dst.getCell(3, 4).char, "E");
		assert.strictEqual(dst.getCell(4, 4).char, "F");
	});

	it("preserves styleId on copied cells", () => {
		const dst = new Screen(5, 5);
		const src = new Screen(2, 1);
		src.writeText(0, 0, "AB", 7);
		dst.blit(src, 1, 0);
		assert.strictEqual(dst.getCell(1, 0).styleId, 7);
		assert.strictEqual(dst.getCell(2, 0).styleId, 7);
	});

	it("clips src content that falls outside dst bounds", () => {
		const dst = new Screen(5, 5);
		const src = new Screen(4, 4);
		src.writeText(0, 0, "ABCD", 0);
		dst.blit(src, 3, 0); // A at x=3, B at x=4, C/D clipped
		assert.strictEqual(dst.getCell(3, 0).char, "A");
		assert.strictEqual(dst.getCell(4, 0).char, "B");
	});

	it("clips src rows that fall outside dst bounds", () => {
		const dst = new Screen(3, 2);
		const src = new Screen(3, 4);
		src.writeText(0, 0, "AAA", 0);
		src.writeText(0, 1, "BBB", 0);
		src.writeText(0, 2, "CCC", 0);
		src.writeText(0, 3, "DDD", 0);
		dst.blit(src, 0, 0); // only first 2 rows fit
		assert.strictEqual(dst.getCell(0, 0).char, "A");
		assert.strictEqual(dst.getCell(0, 1).char, "B");
	});

	it("produces independent cell copies", () => {
		const dst = new Screen(3, 1);
		const src = new Screen(3, 1);
		src.writeText(0, 0, "ABC", 0);
		dst.blit(src, 0, 0);
		// Mutating src after blit must not affect dst.
		src.setCell(0, 0, { char: "Z", width: 1, styleId: 0 });
		assert.strictEqual(dst.getCell(0, 0).char, "A");
	});
});

// --
// Screen.clip tests

describe("Screen.clip", () => {
	it("returns a sub-screen with the specified region", () => {
		const screen = new Screen(5, 5);
		screen.writeText(0, 0, "HELLO", 0);
		screen.writeText(0, 1, "WORLD", 0);
		const sub = screen.clip(1, 0, 3, 2);
		assert.strictEqual(sub.width, 3);
		assert.strictEqual(sub.height, 2);
		assert.strictEqual(sub.getCell(0, 0).char, "E");
		assert.strictEqual(sub.getCell(1, 0).char, "L");
		assert.strictEqual(sub.getCell(2, 0).char, "L");
		assert.strictEqual(sub.getCell(0, 1).char, "O");
		assert.strictEqual(sub.getCell(2, 1).char, "L");
	});

	it("produces an independent copy", () => {
		const screen = new Screen(3, 3);
		screen.writeText(0, 0, "ABC", 0);
		const sub = screen.clip(0, 0, 3, 1);
		sub.setCell(0, 0, { char: "X", width: 1, styleId: 0 });
		assert.strictEqual(screen.getCell(0, 0).char, "A");
		assert.strictEqual(sub.getCell(0, 0).char, "X");
	});

	it("fills out-of-bounds source positions with EMPTY_CELL", () => {
		const screen = new Screen(2, 2);
		screen.writeText(0, 0, "AB", 0);
		// Clip a 4x4 region from a 2x2 screen — bottom-right quadrant is OOB.
		const sub = screen.clip(0, 0, 4, 4);
		assert.strictEqual(sub.width, 4);
		assert.strictEqual(sub.height, 4);
		assert.strictEqual(sub.getCell(0, 0).char, "A");
		assert.strictEqual(sub.getCell(3, 3).char, " ");
	});

	it("shares pools with the parent screen", () => {
		const screen = new Screen(2, 2);
		const sub = screen.clip(0, 0, 1, 1);
		assert.strictEqual(sub.charPool, screen.charPool);
		assert.strictEqual(sub.stylePool, screen.stylePool);
		assert.strictEqual(sub.hyperlinkPool, screen.hyperlinkPool);
	});
});

// --
// Screen.shiftRows tests

describe("Screen.shiftRows", () => {
	it("shifts rows up by delta", () => {
		const screen = new Screen(3, 4);
		screen.writeText(0, 0, "AAA", 0);
		screen.writeText(0, 1, "BBB", 0);
		screen.writeText(0, 2, "CCC", 0);
		screen.writeText(0, 3, "DDD", 0);
		screen.shiftRows(0, 4, 1); // shift up by 1
		assert.strictEqual(screen.getCell(0, 0).char, "B");
		assert.strictEqual(screen.getCell(0, 1).char, "C");
		assert.strictEqual(screen.getCell(0, 2).char, "D");
		// Row 3 is vacated and cleared.
		assert.strictEqual(screen.getCell(0, 3).char, " ");
	});

	it("shifts rows down by delta", () => {
		const screen = new Screen(3, 4);
		screen.writeText(0, 0, "AAA", 0);
		screen.writeText(0, 1, "BBB", 0);
		screen.writeText(0, 2, "CCC", 0);
		screen.writeText(0, 3, "DDD", 0);
		screen.shiftRows(0, 4, -1); // shift down by 1
		assert.strictEqual(screen.getCell(0, 0).char, " "); // vacated
		assert.strictEqual(screen.getCell(0, 1).char, "A");
		assert.strictEqual(screen.getCell(0, 2).char, "B");
		assert.strictEqual(screen.getCell(0, 3).char, "C");
	});

	it("shifts up by more than 1", () => {
		const screen = new Screen(1, 5);
		screen.writeText(0, 0, "A", 0);
		screen.writeText(0, 1, "B", 0);
		screen.writeText(0, 2, "C", 0);
		screen.writeText(0, 3, "D", 0);
		screen.writeText(0, 4, "E", 0);
		screen.shiftRows(0, 5, 2); // shift up by 2
		assert.strictEqual(screen.getCell(0, 0).char, "C");
		assert.strictEqual(screen.getCell(0, 1).char, "D");
		assert.strictEqual(screen.getCell(0, 2).char, "E");
		assert.strictEqual(screen.getCell(0, 3).char, " ");
		assert.strictEqual(screen.getCell(0, 4).char, " ");
	});

	it("clears all rows when delta exceeds range height", () => {
		const screen = new Screen(3, 2);
		screen.writeText(0, 0, "AAA", 0);
		screen.writeText(0, 1, "BBB", 0);
		screen.shiftRows(0, 2, 5); // shift up by 5 (> height)
		assert.strictEqual(screen.getCell(0, 0).char, " ");
		assert.strictEqual(screen.getCell(0, 1).char, " ");
	});

	it("is a no-op when delta is 0", () => {
		const screen = new Screen(2, 2);
		screen.writeText(0, 0, "AB", 0);
		screen.shiftRows(0, 2, 0);
		assert.strictEqual(screen.getCell(0, 0).char, "A");
		assert.strictEqual(screen.getCell(1, 0).char, "B");
	});

	it("only affects the specified row range", () => {
		const screen = new Screen(1, 5);
		screen.writeText(0, 0, "A", 0);
		screen.writeText(0, 1, "B", 0);
		screen.writeText(0, 2, "C", 0);
		screen.writeText(0, 3, "D", 0);
		screen.writeText(0, 4, "E", 0);
		screen.shiftRows(1, 4, 1); // rows 1..3 inclusive, shift up
		assert.strictEqual(screen.getCell(0, 0).char, "A"); // unchanged
		assert.strictEqual(screen.getCell(0, 1).char, "C");
		assert.strictEqual(screen.getCell(0, 2).char, "D");
		assert.strictEqual(screen.getCell(0, 3).char, " "); // vacated
		assert.strictEqual(screen.getCell(0, 4).char, "E"); // unchanged
	});

	it("clamps out-of-range startRow/endRow", () => {
		const screen = new Screen(1, 3);
		screen.writeText(0, 0, "A", 0);
		screen.writeText(0, 1, "B", 0);
		screen.writeText(0, 2, "C", 0);
		// Negative startRow and past-height endRow should be clamped.
		screen.shiftRows(-5, 100, 1);
		assert.strictEqual(screen.getCell(0, 0).char, "B");
		assert.strictEqual(screen.getCell(0, 1).char, "C");
		assert.strictEqual(screen.getCell(0, 2).char, " ");
	});
});

// --
// Screen.diffEach tests

describe("Screen.diffEach", () => {
	it("reports changed cells", () => {
		const prev = new Screen(3, 2);
		prev.writeText(0, 0, "ABC", 0);
		prev.writeText(0, 1, "DEF", 0);
		const cur = prev.clone();
		cur.setCell(1, 0, { char: "X", width: 1, styleId: 0 });
		const diffs: Array<{ x: number; y: number; prevChar: string; curChar: string }> = [];
		cur.diffEach(prev, (x, y, p, c) => {
			diffs.push({
				x,
				y,
				prevChar: p?.char ?? "?",
				curChar: c?.char ?? "?",
			});
		});
		assert.strictEqual(diffs.length, 1);
		assert.strictEqual(diffs[0].x, 1);
		assert.strictEqual(diffs[0].y, 0);
		assert.strictEqual(diffs[0].prevChar, "B");
		assert.strictEqual(diffs[0].curChar, "X");
	});

	it("reports added cells when cur grows", () => {
		const prev = new Screen(2, 1);
		prev.writeText(0, 0, "AB", 0);
		const cur = new Screen(3, 1);
		cur.writeText(0, 0, "ABC", 0);
		let addedCount = 0;
		cur.diffEach(prev, (_x, _y, p, c) => {
			if (p === undefined && c !== undefined) addedCount++;
		});
		assert.strictEqual(addedCount, 1); // cell (2, 0) is new
	});

	it("reports removed cells when cur shrinks", () => {
		const prev = new Screen(3, 1);
		prev.writeText(0, 0, "ABC", 0);
		const cur = new Screen(2, 1);
		cur.writeText(0, 0, "AB", 0);
		let removedCount = 0;
		cur.diffEach(prev, (_x, _y, p, c) => {
			if (p !== undefined && c === undefined) removedCount++;
		});
		assert.strictEqual(removedCount, 1); // cell (2, 0) was removed
	});

	it("supports early exit via callback return value", () => {
		const prev = new Screen(3, 1);
		prev.writeText(0, 0, "ABC", 0);
		const cur = new Screen(3, 1);
		cur.writeText(0, 0, "XYZ", 0);
		let count = 0;
		const result = cur.diffEach(prev, () => {
			count++;
			return true; // request early exit
		});
		assert.strictEqual(result, true);
		assert.strictEqual(count, 1); // only the first diff was reported
	});

	it("does not report unchanged cells", () => {
		const prev = new Screen(3, 2);
		prev.writeText(0, 0, "ABC", 0);
		prev.writeText(0, 1, "DEF", 0);
		const cur = prev.clone();
		let count = 0;
		cur.diffEach(prev, () => {
			count++;
		});
		assert.strictEqual(count, 0);
	});

	it("treats out-of-bounds as EMPTY_CELL for comparison", () => {
		// prev is 3x1 with "ABC"; cur is 3x1 with "AB " (last cell cleared).
		// No resize diff — both screens are 3x1.
		const prev = new Screen(3, 1);
		prev.writeText(0, 0, "ABC", 0);
		const cur = new Screen(3, 1);
		cur.writeText(0, 0, "AB", 0); // cell (2,0) stays EMPTY_CELL
		const diffs: Array<{ x: number; y: number }> = [];
		cur.diffEach(prev, (x, y) => {
			diffs.push({ x, y });
		});
		assert.strictEqual(diffs.length, 1);
		assert.strictEqual(diffs[0].x, 2);
		assert.strictEqual(diffs[0].y, 0);
	});

	it("detects styleId changes", () => {
		const prev = new Screen(1, 1);
		prev.setCell(0, 0, { char: "A", width: 1, styleId: 0 });
		const cur = new Screen(1, 1);
		cur.setCell(0, 0, { char: "A", width: 1, styleId: 5 });
		const diffs: Array<{ x: number; y: number }> = [];
		cur.diffEach(prev, (x, y) => {
			diffs.push({ x, y });
		});
		assert.strictEqual(diffs.length, 1);
	});

	it("detects hyperlink changes", () => {
		const prev = new Screen(1, 1);
		prev.setCell(0, 0, { char: "A", width: 1, styleId: 0, hyperlink: 1 });
		const cur = new Screen(1, 1);
		cur.setCell(0, 0, { char: "A", width: 1, styleId: 0, hyperlink: 2 });
		const diffs: Array<{ x: number; y: number }> = [];
		cur.diffEach(prev, (x, y) => {
			diffs.push({ x, y });
		});
		assert.strictEqual(diffs.length, 1);
	});
});

// --
// Screen.clone + equals tests

describe("Screen.clone and equals", () => {
	it("clone produces an equal screen", () => {
		const screen = new Screen(3, 2);
		screen.writeText(0, 0, "ABC", 0);
		screen.writeText(0, 1, "DEF", 0);
		const clone = screen.clone();
		assert.strictEqual(screen.equals(clone), true);
	});

	it("clone is independent", () => {
		const screen = new Screen(3, 1);
		screen.writeText(0, 0, "ABC", 0);
		const clone = screen.clone();
		clone.setCell(0, 0, { char: "X", width: 1, styleId: 0 });
		assert.strictEqual(screen.getCell(0, 0).char, "A"); // unchanged
		assert.strictEqual(clone.getCell(0, 0).char, "X");
		assert.strictEqual(screen.equals(clone), false);
	});

	it("clone shares pools with the original", () => {
		const screen = new Screen(2, 2);
		const clone = screen.clone();
		assert.strictEqual(clone.charPool, screen.charPool);
		assert.strictEqual(clone.stylePool, screen.stylePool);
		assert.strictEqual(clone.hyperlinkPool, screen.hyperlinkPool);
	});

	it("equals returns false for different sizes", () => {
		const a = new Screen(3, 2);
		const b = new Screen(2, 3);
		assert.strictEqual(a.equals(b), false);
	});

	it("equals returns false for different content", () => {
		const a = new Screen(2, 1);
		a.writeText(0, 0, "AB", 0);
		const b = new Screen(2, 1);
		b.writeText(0, 0, "AC", 0);
		assert.strictEqual(a.equals(b), false);
	});

	it("equals returns false for different styleId", () => {
		const a = new Screen(1, 1);
		a.setCell(0, 0, { char: "A", width: 1, styleId: 0 });
		const b = new Screen(1, 1);
		b.setCell(0, 0, { char: "A", width: 1, styleId: 1 });
		assert.strictEqual(a.equals(b), false);
	});

	it("equals returns true for two empty screens of same size", () => {
		const a = new Screen(3, 3);
		const b = new Screen(3, 3);
		assert.strictEqual(a.equals(b), true);
	});
});

// --
// Screen.fillRegion and clearRegion tests

describe("Screen.fillRegion and clearRegion", () => {
	it("fillRegion fills with a custom cell", () => {
		const screen = new Screen(4, 4);
		const cell = { char: "X", width: 1, styleId: 3 };
		screen.fillRegion(1, 1, 2, 2, cell);
		assert.strictEqual(screen.getCell(1, 1).char, "X");
		assert.strictEqual(screen.getCell(1, 1).styleId, 3);
		assert.strictEqual(screen.getCell(2, 2).char, "X");
		// Outside the region stays empty.
		assert.strictEqual(screen.getCell(0, 0).char, " ");
	});

	it("fillRegion defaults to EMPTY_CELL", () => {
		const screen = new Screen(3, 3);
		screen.writeText(0, 0, "ABC", 0);
		screen.fillRegion(0, 0, 2, 1);
		assert.strictEqual(screen.getCell(0, 0).char, " ");
		assert.strictEqual(screen.getCell(1, 0).char, " ");
		assert.strictEqual(screen.getCell(2, 0).char, "C"); // outside the region
	});

	it("clearRegion clears the specified rectangle", () => {
		const screen = new Screen(3, 3);
		screen.writeText(0, 0, "ABC", 0);
		screen.writeText(0, 1, "DEF", 0);
		screen.clearRegion(0, 0, 2, 2);
		assert.strictEqual(screen.getCell(0, 0).char, " ");
		assert.strictEqual(screen.getCell(1, 0).char, " ");
		assert.strictEqual(screen.getCell(0, 1).char, " ");
		assert.strictEqual(screen.getCell(1, 1).char, " ");
		// Outside the region is unchanged.
		assert.strictEqual(screen.getCell(2, 0).char, "C");
		assert.strictEqual(screen.getCell(2, 1).char, "F");
	});

	it("fillRegion produces independent cell copies", () => {
		const screen = new Screen(2, 1);
		const cell = { char: "X", width: 1, styleId: 0 };
		screen.fillRegion(0, 0, 2, 1, cell);
		// Mutating one cell should not affect the other.
		screen.setCell(0, 0, { char: "Y", width: 1, styleId: 0 });
		assert.strictEqual(screen.getCell(0, 0).char, "Y");
		assert.strictEqual(screen.getCell(1, 0).char, "X");
	});

	it("fillRegion is a no-op for zero or negative dimensions", () => {
		const screen = new Screen(2, 2);
		screen.writeText(0, 0, "AB", 0);
		screen.fillRegion(0, 0, 0, 2);
		assert.strictEqual(screen.getCell(0, 0).char, "A");
		screen.fillRegion(0, 0, 2, -1);
		assert.strictEqual(screen.getCell(0, 0).char, "A");
	});
});

// --
// Screen pool integration tests

describe("Screen pool integration", () => {
	it("exposes pool references on the screen", () => {
		const screen = new Screen(2, 2);
		assert.ok(screen.charPool instanceof CharPool);
		assert.ok(screen.stylePool instanceof StylePool);
		assert.ok(screen.hyperlinkPool instanceof HyperlinkPool);
	});

	it("cloned screens share the same pool instances", () => {
		const screen = new Screen(2, 2);
		const clone = screen.clone();
		assert.strictEqual(clone.charPool, screen.charPool);
		assert.strictEqual(clone.stylePool, screen.stylePool);
		assert.strictEqual(clone.hyperlinkPool, screen.hyperlinkPool);
	});

	it("independently-constructed screens have separate pools", () => {
		const a = new Screen(2, 2);
		const b = new Screen(2, 2);
		assert.notStrictEqual(a.charPool, b.charPool);
		assert.notStrictEqual(a.stylePool, b.stylePool);
		assert.notStrictEqual(a.hyperlinkPool, b.hyperlinkPool);
	});

	it("can share pools via ScreenPools option", () => {
		const shared = {
			charPool: new CharPool(),
			stylePool: new StylePool(),
			hyperlinkPool: new HyperlinkPool(),
		};
		const a = new Screen(2, 2, shared);
		const b = new Screen(2, 2, shared);
		assert.strictEqual(a.charPool, b.charPool);
		assert.strictEqual(a.stylePool, b.stylePool);
		assert.strictEqual(a.hyperlinkPool, b.hyperlinkPool);
		// IDs interned in one are valid in the other.
		const id = a.stylePool.add({ color: "ansi:red" });
		assert.strictEqual(b.stylePool.get(id)?.color, "ansi:red");
	});
});

// --
// Regression: P0 API still works

describe("Screen P0 API regression", () => {
	it("getCell returns EMPTY_CELL for out-of-bounds reads", () => {
		const screen = new Screen(2, 2);
		const cell = screen.getCell(5, 5);
		assert.strictEqual(cell.char, " ");
		assert.strictEqual(cell.width, 1);
		assert.strictEqual(cell.styleId, 0);
	});

	it("setCell ignores out-of-bounds writes", () => {
		const screen = new Screen(2, 2);
		screen.setCell(5, 5, { char: "X", width: 1, styleId: 0 });
		// No throw, no effect.
		assert.strictEqual(screen.getCell(0, 0).char, " ");
	});

	it("writeText writes single-width characters", () => {
		const screen = new Screen(5, 1);
		screen.writeText(0, 0, "Hello", 0);
		assert.strictEqual(screen.getCell(0, 0).char, "H");
		assert.strictEqual(screen.getCell(4, 0).char, "o");
	});

	it("fill fills a rectangle", () => {
		const screen = new Screen(3, 3);
		screen.fill(0, 0, 2, 2, "X", 1);
		assert.strictEqual(screen.getCell(0, 0).char, "X");
		assert.strictEqual(screen.getCell(0, 0).styleId, 1);
		assert.strictEqual(screen.getCell(1, 1).char, "X");
		// Outside the region.
		assert.strictEqual(screen.getCell(2, 2).char, " ");
	});

	it("clear resets every cell", () => {
		const screen = new Screen(2, 2);
		screen.writeText(0, 0, "AB", 0);
		screen.clear();
		assert.strictEqual(screen.getCell(0, 0).char, " ");
		assert.strictEqual(screen.getCell(1, 0).char, " ");
	});

	it("resize preserves overlapping content", () => {
		const screen = new Screen(2, 2);
		screen.writeText(0, 0, "AB", 0);
		screen.resize(3, 1);
		assert.strictEqual(screen.width, 3);
		assert.strictEqual(screen.height, 1);
		assert.strictEqual(screen.getCell(0, 0).char, "A");
		assert.strictEqual(screen.getCell(1, 0).char, "B");
		assert.strictEqual(screen.getCell(2, 0).char, " "); // new cell
	});

	it("diff returns changed coordinates", () => {
		const a = new Screen(2, 1);
		a.writeText(0, 0, "AB", 0);
		const b = new Screen(2, 1);
		b.writeText(0, 0, "AC", 0);
		const diffs = a.diff(b);
		assert.strictEqual(diffs.length, 1);
		assert.strictEqual(diffs[0].x, 1);
		assert.strictEqual(diffs[0].y, 0);
	});
});
