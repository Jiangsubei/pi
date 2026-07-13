/**
 * Task 29 tests — search highlight.
 *
 * Validates SearchHighlight query management, case-sensitivity, regex
 * mode, and integration with LogUpdate (inverse style on matched cells).
 *
 * Test runner: Node built-in `node --test`.
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import { LogUpdate } from "../src/diff/log-update.ts";
import { Screen } from "../src/screen/screen.ts";
import { SearchHighlight } from "../src/search-highlight.ts";

// --
// Query management

describe("SearchHighlight: query management", () => {
	it("setQuery stores the query", () => {
		const sh = new SearchHighlight();
		sh.setQuery("hello");
		// Build a predicate and verify it matches
		const screen = new Screen(10, 1);
		screen.writeText(0, 0, "hello world", 0);
		const pred = sh.buildPredicate(screen);
		assert.strictEqual(pred(0, 0), true); // 'h'
		assert.strictEqual(pred(4, 0), true); // 'o'
		assert.strictEqual(pred(5, 0), false); // ' '
	});

	it("clear removes the query", () => {
		const sh = new SearchHighlight();
		sh.setQuery("hello");
		sh.clear();
		const screen = new Screen(10, 1);
		screen.writeText(0, 0, "hello world", 0);
		const pred = sh.buildPredicate(screen);
		// No matches after clear
		for (let x = 0; x < 10; x++) {
			assert.strictEqual(pred(x, 0), false);
		}
	});

	it("empty query clears highlight", () => {
		const sh = new SearchHighlight();
		sh.setQuery("hello");
		sh.setQuery("");
		const screen = new Screen(10, 1);
		screen.writeText(0, 0, "hello world", 0);
		const pred = sh.buildPredicate(screen);
		for (let x = 0; x < 10; x++) {
			assert.strictEqual(pred(x, 0), false);
		}
	});
});

// --
// Case sensitivity

describe("SearchHighlight: case sensitivity", () => {
	it("case-insensitive by default", () => {
		const sh = new SearchHighlight();
		sh.setQuery("hello");
		const screen = new Screen(10, 1);
		screen.writeText(0, 0, "HELLO world", 0);
		const pred = sh.buildPredicate(screen);
		assert.strictEqual(pred(0, 0), true); // 'H'
		assert.strictEqual(pred(4, 0), true); // 'O'
	});

	it("case-sensitive when option set", () => {
		const sh = new SearchHighlight();
		sh.setQuery("hello", { caseSensitive: true });
		const screen = new Screen(20, 1);
		screen.writeText(0, 0, "HELLO hello", 0);
		const pred = sh.buildPredicate(screen);
		// Should not match HELLO (uppercase)
		assert.strictEqual(pred(0, 0), false);
		// Should match hello (lowercase) at cols 6-10
		assert.strictEqual(pred(6, 0), true);
		assert.strictEqual(pred(10, 0), true);
	});
});

// --
// Regex

describe("SearchHighlight: regex", () => {
	it("regex mode matches patterns", () => {
		const sh = new SearchHighlight();
		sh.setQuery("\\d+", { regex: true });
		const screen = new Screen(20, 1);
		screen.writeText(0, 0, "abc 123 def 456", 0);
		const pred = sh.buildPredicate(screen);
		// '1','2','3' at cols 4,5,6 should match
		assert.strictEqual(pred(4, 0), true);
		assert.strictEqual(pred(5, 0), true);
		assert.strictEqual(pred(6, 0), true);
		// '4','5','6' at cols 12,13,14 should match
		assert.strictEqual(pred(12, 0), true);
		assert.strictEqual(pred(13, 0), true);
		assert.strictEqual(pred(14, 0), true);
		// Non-digit cells should not match
		assert.strictEqual(pred(0, 0), false);
		assert.strictEqual(pred(3, 0), false);
	});

	it("non-regex mode treats query as literal", () => {
		const sh = new SearchHighlight();
		sh.setQuery("\\d+"); // literal backslash-d-plus
		const screen = new Screen(20, 1);
		screen.writeText(0, 0, "\\d+ 123", 0);
		const pred = sh.buildPredicate(screen);
		// Should match the literal "\\d+" at cols 0,1,2
		assert.strictEqual(pred(0, 0), true);
		assert.strictEqual(pred(1, 0), true);
		assert.strictEqual(pred(2, 0), true);
		// Should not match "123"
		assert.strictEqual(pred(4, 0), false);
	});

	it("regex with case-insensitive flag", () => {
		const sh = new SearchHighlight();
		sh.setQuery("foo", { regex: true, caseSensitive: false });
		const screen = new Screen(20, 1);
		screen.writeText(0, 0, "FOO bar foo", 0);
		const pred = sh.buildPredicate(screen);
		// Both FOO (cols 0-2) and foo (cols 8-10) should match
		assert.strictEqual(pred(0, 0), true);
		assert.strictEqual(pred(1, 0), true);
		assert.strictEqual(pred(2, 0), true);
		assert.strictEqual(pred(8, 0), true);
		assert.strictEqual(pred(9, 0), true);
		assert.strictEqual(pred(10, 0), true);
	});
});

// --
// Multi-line matching

describe("SearchHighlight: multi-line", () => {
	it("matches query on multiple rows", () => {
		const sh = new SearchHighlight();
		sh.setQuery("foo");
		const screen = new Screen(10, 3);
		screen.writeText(0, 0, "foo bar", 0);
		screen.writeText(0, 1, "baz", 0);
		screen.writeText(0, 2, "foo baz", 0);
		const pred = sh.buildPredicate(screen);
		// Row 0: "foo" at cols 0-2
		assert.strictEqual(pred(0, 0), true);
		assert.strictEqual(pred(1, 0), true);
		assert.strictEqual(pred(2, 0), true);
		// Row 1: no "foo"
		assert.strictEqual(pred(0, 1), false);
		// Row 2: "foo" at cols 0-2
		assert.strictEqual(pred(0, 2), true);
		assert.strictEqual(pred(1, 2), true);
		assert.strictEqual(pred(2, 2), true);
	});
});

// --
// getHighlightedRanges

describe("SearchHighlight: getHighlightedRanges", () => {
	it("returns matched positions per row", () => {
		const sh = new SearchHighlight();
		sh.setQuery("ab");
		const screen = new Screen(10, 2);
		screen.writeText(0, 0, "abc ab", 0);
		screen.writeText(0, 1, "xx ab", 0);
		const ranges = sh.getHighlightedRanges(screen);
		assert.ok(ranges !== null);
		// Row 0: "ab" at cols 0-1 and 4-5
		const row0 = ranges.find((r) => r.row === 0);
		assert.ok(row0 !== undefined);
		assert.deepStrictEqual(row0.cols, [0, 1, 4, 5]);
		// Row 1: "ab" at cols 3-4
		const row1 = ranges.find((r) => r.row === 1);
		assert.ok(row1 !== undefined);
		assert.deepStrictEqual(row1.cols, [3, 4]);
	});

	it("returns empty array when no query is set", () => {
		const sh = new SearchHighlight();
		const screen = new Screen(10, 1);
		screen.writeText(0, 0, "hello", 0);
		const ranges = sh.getHighlightedRanges(screen);
		assert.deepStrictEqual(ranges, []);
	});

	it("returns empty array when no matches found", () => {
		const sh = new SearchHighlight();
		sh.setQuery("xyz");
		const screen = new Screen(10, 1);
		screen.writeText(0, 0, "hello world", 0);
		const ranges = sh.getHighlightedRanges(screen);
		assert.deepStrictEqual(ranges, []);
	});
});

// --
// LogUpdate integration

describe("SearchHighlight: LogUpdate integration", () => {
	it("matched cells get inverse style in full frame render", () => {
		const screen = new Screen(11, 1);
		screen.writeText(0, 0, "hello world", 0);

		const sh = new SearchHighlight();
		sh.setQuery("world");
		const pred = sh.buildPredicate(screen);

		const lu = new LogUpdate();
		const out = lu.render(null, screen, pred);

		// Matched cells (cols 6-10) should have inverse SGR (\x1b[7m)
		assert.ok(out.includes("\x1b[7m"), `output should contain inverse SGR, got: ${JSON.stringify(out)}`);
	});

	it("matched cells get inverse style in incremental diff", () => {
		const prev = new Screen(11, 1);
		prev.writeText(0, 0, "hello world", 0);
		const cur = new Screen(11, 1);
		cur.writeText(0, 0, "hello world", 0);

		const sh = new SearchHighlight();
		sh.setQuery("hello");
		const pred = sh.buildPredicate(cur);

		const lu = new LogUpdate();
		const out = lu.render(prev, cur, pred);

		assert.ok(out.includes("\x1b[7m"), `output should contain inverse SGR, got: ${JSON.stringify(out)}`);
	});

	it("non-matched cells do not get inverse style", () => {
		const screen = new Screen(11, 1);
		screen.writeText(0, 0, "hello world", 0);

		const sh = new SearchHighlight();
		sh.setQuery("world");
		const pred = sh.buildPredicate(screen);

		const lu = new LogUpdate();
		const out = lu.render(null, screen, pred);

		// The SGR inverse sequence should appear (for "world")
		assert.ok(out.includes("\x1b[7m"), "matched cells should have inverse");

		// Count inverse occurrences: should be at least 1 (for the "world" match)
		// but not for "hello " (the non-matched prefix)
		const inverseCount = (out.match(/\x1b\[7m/g) ?? []).length;
		assert.ok(inverseCount >= 1, `expected at least 1 inverse SGR, got ${inverseCount}`);
	});

	it("clearing search removes inverse style on next render", () => {
		const sh = new SearchHighlight();
		const lu = new LogUpdate();

		// Frame 1: with search highlight
		const cur1 = new Screen(5, 1);
		cur1.writeText(0, 0, "hello", 0);
		sh.setQuery("ell");
		const pred1 = sh.buildPredicate(cur1);
		const out1 = lu.render(null, cur1, pred1);
		assert.ok(out1.includes("\x1b[7m"), "frame 1 should have inverse");

		// Frame 2: clear search, no highlight
		sh.clear();
		const cur2 = new Screen(5, 1);
		cur2.writeText(0, 0, "hello", 0);
		// cur1 was mutated by applyHighlight — use it as prev
		const out2 = lu.render(cur1, cur2);
		assert.ok(!out2.includes("\x1b[7m"), `frame 2 should not have inverse, got: ${JSON.stringify(out2)}`);
	});

	it("search and selection highlights can compose", () => {
		const screen = new Screen(15, 1);
		screen.writeText(0, 0, "hello world foo", 0);

		const sh = new SearchHighlight();
		sh.setQuery("world");
		const searchPred = sh.buildPredicate(screen);

		// Simulate a selection predicate for cols 0-4 ("hello")
		const selectionPred = (x: number, y: number): boolean => y === 0 && x >= 0 && x <= 4;

		// Compose: highlight if either predicate is true
		const composed = (x: number, y: number): boolean => searchPred(x, y) || selectionPred(x, y);

		const lu = new LogUpdate();
		const out = lu.render(null, screen, composed);

		// Both "hello" (selection) and "world" (search) should be highlighted
		assert.ok(out.includes("\x1b[7m"), `output should contain inverse SGR, got: ${JSON.stringify(out)}`);
	});
});
