/**
 * P5 Task 32.6 — Performance optimization regression tests.
 *
 * Three test groups that validate the correctness of the P5 Task 32
 * optimizations:
 *
 *   1. Dirty subtree diff correctness — `LogUpdate.render` with
 *      `dirtyYRanges` produces the same output as a full scan when
 *      the ranges cover all changed rows, and restricts the scan
 *      (smaller output) when ranges exclude changed rows.
 *   2. Row skip consistency — `Screen.getRowHash` equality implies
 *      cell-by-cell equality (verified via `Screen.diffRow`), and a
 *      single-cell change flips the hash for that row only.
 *   3. getRowHash update on setCell — `Screen.setCell` invalidates
 *      the row-hash cache so the next `getRowHash` call reflects
 *      the new content; restoring the original cell restores the
 *      original hash; other rows' hashes are unaffected.
 *
 * These tests guard against regressions in the diff engine when the
 * dirty-subtree and row-hash fast paths are active.
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import { LogUpdate } from "../src/diff/log-update.ts";
import { Screen } from "../src/screen/screen.ts";

// --
// Test 1: Dirty subtree diff correctness
//
// Verifies that passing `dirtyYRanges` to `LogUpdate.render` does not
// change the emitted ANSI when the ranges cover every changed row
// (correctness), and that excluding a changed row produces a smaller
// output (the optimization actually restricts the scan).

describe("P5 Task 32: dirty subtree diff correctness", () => {
	it("produces same output as full scan when dirtyYRanges cover all changes, and smaller output when ranges exclude a change", () => {
		// Build a 10×5 prev screen with distinct content per row.
		const prev = new Screen(10, 5);
		prev.writeText(0, 0, "AAAAAAAAAA", 0);
		prev.writeText(0, 1, "BBBBBBBBBB", 0);
		prev.writeText(0, 2, "CCCCCCCCCC", 0);
		prev.writeText(0, 3, "DDDDDDDDDD", 0);
		prev.writeText(0, 4, "EEEEEEEEEE", 0);

		// cur changes rows 1 and 3 only.
		const cur = prev.clone();
		cur.writeText(0, 1, "XXXXXXXXXX", 0);
		cur.writeText(0, 3, "YYYYYYYYYY", 0);

		const lu = new LogUpdate();

		// Full scan — no dirtyYRanges hint.
		const fullOutput = lu.render(prev, cur);

		// Targeted scan — ranges cover exactly the changed rows.
		const targetedOutput = lu.render(prev, cur, undefined, [
			[1, 2],
			[3, 4],
		]);

		// Correctness: same output when ranges cover all changes.
		assert.strictEqual(targetedOutput, fullOutput, "targeted diff with covering ranges must match full scan");

		// Optimization: excluding row 3's range produces a smaller
		// output (row 3's change is missed). This demonstrates the
		// dirty y-range hint actually restricts the scan — a full
		// scan would have emitted row 3's change.
		const partialOutput = lu.render(prev, cur, undefined, [[1, 2]]);
		assert.ok(
			partialOutput.length < fullOutput.length,
			"partial scan (only row 1) must produce fewer bytes than full scan",
		);
		// The partial output must contain the row-1 change ("X") but
		// not the row-3 change ("Y").
		assert.ok(partialOutput.includes("X"), "partial output should contain row-1 change");
		assert.ok(!partialOutput.includes("Y"), "partial output should miss row-3 change");
	});
});

// --
// Test 2: Row skip consistency
//
// Verifies that `Screen.getRowHash` equality implies cell-by-cell
// equality (no false positives that would cause the diff to skip a
// changed row), and that a single-cell change flips the hash for that
// row while leaving other rows' hashes unchanged.

describe("P5 Task 32: row skip consistency", () => {
	it("getRowHash equality implies cell-by-cell equality via diffRow, and single-cell change flips only that row's hash", () => {
		const prev = new Screen(5, 3);
		prev.writeText(0, 0, "AAAAA", 0);
		prev.writeText(0, 1, "BBBBB", 0);
		prev.writeText(0, 2, "CCCCC", 0);

		const cur = prev.clone();

		// All rows identical → all hashes equal.
		for (let y = 0; y < 3; y++) {
			assert.strictEqual(
				cur.getRowHash(y),
				prev.getRowHash(y),
				`row ${y} hashes should match for identical screens`,
			);
		}

		// diffRow finds no differences for rows with matching hashes.
		for (let y = 0; y < 3; y++) {
			let diffCount = 0;
			cur.diffRow(prev, y, () => {
				diffCount++;
			});
			assert.strictEqual(diffCount, 0, `row ${y} should have no diffs when hashes match`);
		}

		// Modify a single cell in row 1.
		cur.setCell(0, 1, { char: "X", width: 1, styleId: 0 });

		// Row 1's hash must change; rows 0 and 2 must stay the same.
		assert.notStrictEqual(cur.getRowHash(1), prev.getRowHash(1), "row 1 hash must change after setCell");
		assert.strictEqual(cur.getRowHash(0), prev.getRowHash(0), "row 0 hash must be unaffected by row 1 change");
		assert.strictEqual(cur.getRowHash(2), prev.getRowHash(2), "row 2 hash must be unaffected by row 1 change");

		// diffRow on row 1 finds exactly 1 difference (column 0).
		let row1DiffCount = 0;
		cur.diffRow(prev, 1, () => {
			row1DiffCount++;
		});
		assert.strictEqual(row1DiffCount, 1, "row 1 should have exactly 1 diff after single-cell change");

		// diffRow on rows 0 and 2 still find no differences.
		for (const y of [0, 2]) {
			let diffCount = 0;
			cur.diffRow(prev, y, () => {
				diffCount++;
			});
			assert.strictEqual(diffCount, 0, `row ${y} should still have no diffs`);
		}
	});
});

// --
// Test 3: getRowHash update on setCell
//
// Verifies that `Screen.setCell` invalidates the row-hash cache so the
// next `getRowHash` call reflects the new content. Also verifies that
// restoring the original cell restores the original hash, and that
// modifying one row does not affect other rows' hashes.

describe("P5 Task 32: getRowHash update on setCell", () => {
	it("setCell invalidates hash cache, recomputes on next getRowHash, and does not affect other rows", () => {
		const screen = new Screen(5, 3);
		screen.writeText(0, 0, "AAAAA", 0);
		screen.writeText(0, 1, "BBBBB", 0);
		screen.writeText(0, 2, "CCCCC", 0);

		// Populate the hash cache.
		const hash0Before = screen.getRowHash(0);
		const hash1Before = screen.getRowHash(1);
		const hash2Before = screen.getRowHash(2);

		// Modify a single cell in row 1.
		screen.setCell(0, 1, { char: "X", width: 1, styleId: 0 });

		// Hash for row 1 must change.
		const hash1After = screen.getRowHash(1);
		assert.notStrictEqual(hash1After, hash1Before, "row 1 hash must change after setCell");

		// Hashes for rows 0 and 2 must be unchanged (same content →
		// same hash, even though the cache was invalidated).
		assert.strictEqual(screen.getRowHash(0), hash0Before, "row 0 hash must be unchanged");
		assert.strictEqual(screen.getRowHash(2), hash2Before, "row 2 hash must be unchanged");

		// Restore the original cell — hash must match the original.
		screen.setCell(0, 1, { char: "B", width: 1, styleId: 0 });
		assert.strictEqual(screen.getRowHash(1), hash1Before, "row 1 hash must match original after restoring cell");

		// Modify a different row (row 0) — row 1's hash must stay the
		// same as the original.
		screen.setCell(0, 0, { char: "Z", width: 1, styleId: 0 });
		assert.strictEqual(screen.getRowHash(1), hash1Before, "row 1 hash must be unaffected by row 0 change");
		assert.notStrictEqual(screen.getRowHash(0), hash0Before, "row 0 hash must change after its own setCell");
	});
});
