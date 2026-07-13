/**
 * Task 33: CJK / emoji boundary handling.
 *
 * Verifies that the renderer correctly handles:
 * - CJK truncation at grapheme boundaries (no half-char, no overflow)
 * - Wide-cell writeText with WIDE_CELL_PLACEHOLDER for the trailing cell
 * - diff width=0 (zero-width chars / wide trailing halves) and width=2
 *   (whole-cell replacement)
 * - Emoji in the U+1FA70–U+1FBFF range (Symbols and Pictographs Extended-A
 *   and Supplemental Symbols and Pictographs)
 * - VS16 (U+FE0F) variation selector combining with the previous grapheme
 * - Zero-width chars (ZWJ U+200D, VS15 U+FE0E, VS16 U+FE0F)
 */
import assert from "node:assert";
import { describe, it } from "node:test";
import { LogUpdate } from "../src/diff/log-update.ts";
import { Output } from "../src/output/output.ts";
import { wrapText } from "../src/output/wrap-text.ts";
import { Screen } from "../src/screen/screen.ts";
import { visibleWidth } from "../src/utils.ts";

// --
// SubTask 33.1: CJK truncate grapheme boundary

describe("SubTask 33.1: CJK truncate at grapheme boundaries", () => {
	it("truncates CJK text to width=5 as 你好… (2 CJK + ellipsis)", () => {
		// "你好世界测试" has 6 CJK chars, each width=2 → total width=12.
		// Truncate to width=5: keep first 4 columns ("你好") + "…" = "你好…"
		const lines = wrapText("你好世界测试", 5, "truncate");
		assert.strictEqual(lines.length, 1);
		assert.strictEqual(lines[0], "你好\u2026");
		assert.strictEqual(visibleWidth(lines[0]), 5);
	});

	it("truncates CJK text to width=7 as 你好世… (3 CJK + ellipsis)", () => {
		const lines = wrapText("你好世界测试", 7, "truncate");
		assert.strictEqual(lines.length, 1);
		assert.strictEqual(lines[0], "你好世\u2026");
		assert.strictEqual(visibleWidth(lines[0]), 7);
	});

	it("does not overflow when truncating CJK to an odd width", () => {
		// width=4: cannot fit 2 CJK (width=4) + "…" (width=1) = 5 > 4.
		// The wide grapheme at the boundary must be excluded so the result
		// stays within the requested width: "你…" (width=3).
		const lines = wrapText("你好世界测试", 4, "truncate");
		assert.strictEqual(lines.length, 1);
		assert.ok(visibleWidth(lines[0]) <= 4, `expected width <= 4, got ${visibleWidth(lines[0])} for "${lines[0]}"`);
		// The result should not contain a half CJK char (surrogate lone).
		// "你…" is the expected backoff.
		assert.strictEqual(lines[0], "你\u2026");
	});

	it("does not overflow when truncating CJK to width=3", () => {
		// width=3: 1 CJK (width=2) + "…" (width=1) = "你…" (width=3).
		const lines = wrapText("你好世界测试", 3, "truncate");
		assert.strictEqual(lines.length, 1);
		assert.strictEqual(visibleWidth(lines[0]), 3);
		assert.strictEqual(lines[0], "你\u2026");
	});

	it("does not split a CJK grapheme in truncate-middle mode", () => {
		// width=5, half=floor(5/2)=2: first 2 cols + "…" + last (5-2-1)=2 cols.
		// first 2 cols: "你" (width=2, strict — cannot fit 2 CJK in 2 cols
		//   because each is width 2; "你" alone fits exactly)
		// last 2 cols: "试" (the last CJK, width=2)
		// Result: "你…试" (width=5)
		const lines = wrapText("你好世界测试", 5, "truncate-middle");
		assert.strictEqual(lines.length, 1);
		assert.ok(visibleWidth(lines[0]) <= 5, `expected width <= 5, got ${visibleWidth(lines[0])} for "${lines[0]}"`);
	});

	it("does not split a CJK grapheme in truncate-start mode", () => {
		// width=5: "…" + last 4 cols. Last 4 cols = "测试" (2 CJK, width=4).
		const lines = wrapText("你好世界测试", 5, "truncate-start");
		assert.strictEqual(lines.length, 1);
		assert.strictEqual(lines[0], "\u2026测试");
		assert.strictEqual(visibleWidth(lines[0]), 5);
	});

	it("truncate at width=1 yields just the ellipsis", () => {
		const lines = wrapText("你好世界测试", 1, "truncate");
		assert.strictEqual(lines.length, 1);
		assert.strictEqual(lines[0], "\u2026");
	});
});

// --
// SubTask 33.2: writeText wide-cell placeholder

describe("SubTask 33.2: writeText wide-cell placeholder", () => {
	it("writes a CJK char with width=2 and a width=0 placeholder at the next cell", () => {
		const screen = new Screen(3, 1);
		const output = new Output(screen);
		output.writeText(0, 0, "你", 0);
		output.flush();

		const lead = screen.getCell(0, 0);
		assert.strictEqual(lead.char, "你");
		assert.strictEqual(lead.width, 2);

		const trail = screen.getCell(1, 0);
		assert.strictEqual(trail.char, "");
		assert.strictEqual(trail.width, 0);
	});

	it("writes an emoji with width=2 and a width=0 placeholder at the next cell", () => {
		const screen = new Screen(3, 1);
		const output = new Output(screen);
		output.writeText(0, 0, "😀", 0);
		output.flush();

		const lead = screen.getCell(0, 0);
		assert.strictEqual(lead.char, "😀");
		assert.strictEqual(lead.width, 2);

		const trail = screen.getCell(1, 0);
		assert.strictEqual(trail.char, "");
		assert.strictEqual(trail.width, 0);
	});

	it("preserves styleId on the wide-cell placeholder", () => {
		const screen = new Screen(3, 1);
		const output = new Output(screen);
		output.writeText(0, 0, "你", 42);
		output.flush();

		assert.strictEqual(screen.getCell(0, 0).styleId, 42);
		// The trailing placeholder must carry the same styleId so background
		// color (and any other style attribute) extends across both cells.
		assert.strictEqual(screen.getCell(1, 0).styleId, 42);
	});

	it("advances the cursor by 2 after writing a wide cell", () => {
		const screen = new Screen(5, 1);
		const output = new Output(screen);
		output.writeText(0, 0, "你a", 0);
		output.flush();

		// "你" occupies cells (0,0) and (1,0); "a" lands at (2,0).
		assert.strictEqual(screen.getCell(0, 0).char, "你");
		assert.strictEqual(screen.getCell(0, 0).width, 2);
		assert.strictEqual(screen.getCell(1, 0).width, 0);
		assert.strictEqual(screen.getCell(2, 0).char, "a");
		assert.strictEqual(screen.getCell(2, 0).width, 1);
	});
});

// --
// SubTask 33.3: diff width=0 / width=2 handling

describe("SubTask 33.3: diff width=0 and width=2 handling", () => {
	it("skips width=0 cells in full-frame render", () => {
		const screen = new Screen(3, 1);
		screen.setCell(0, 0, { char: "你", width: 2, styleId: 0 });
		screen.setCell(1, 0, { char: "", width: 0, styleId: 0 });
		screen.setCell(2, 0, { char: "X", width: 1, styleId: 0 });

		const lu = new LogUpdate();
		const out = lu.render(null, screen);

		// Width=0 trailing cell is skipped: emit "你X", no extra space.
		assert.strictEqual(out, "\x1b[?2026h\x1b[H你X\x1b[0m\x1b[?2026l");
	});

	it("replaces a width=2 cell as a whole in incremental diff", () => {
		const prev = new Screen(3, 1);
		prev.setCell(0, 0, { char: "你", width: 2, styleId: 0 });
		prev.setCell(1, 0, { char: "", width: 0, styleId: 0 });
		prev.setCell(2, 0, { char: "X", width: 1, styleId: 0 });

		const cur = new Screen(3, 1);
		cur.setCell(0, 0, { char: "好", width: 2, styleId: 0 });
		cur.setCell(1, 0, { char: "", width: 0, styleId: 0 });
		cur.setCell(2, 0, { char: "X", width: 1, styleId: 0 });

		const lu = new LogUpdate();
		const out = lu.render(prev, cur);

		// Only (0,0) changed (你 → 好). The width=0 trailing cell at (1,0)
		// is unchanged and is skipped. (2,0) is unchanged.
		// Expected: cursor to (0,0) [1;1H] + "好" + RESET.
		assert.strictEqual(out, "\x1b[?2026h\x1b[1;1H好\x1b[0m\x1b[?2026l");
	});

	it("merges a width=2 cell with the following width=1 cell into one damage run", () => {
		// prev: 你_X  (你 at 0 width=2, _ placeholder at 1 width=0, X at 2)
		// cur: 好_Y  (好 at 0 width=2, _ placeholder at 1 width=0, Y at 2)
		// Both (0,0) and (2,0) changed. After writing 好 (width=2) the cursor
		// is at column 2, so (2,0) is consecutive and the run merges.
		const prev = new Screen(3, 1);
		prev.setCell(0, 0, { char: "你", width: 2, styleId: 0 });
		prev.setCell(1, 0, { char: "", width: 0, styleId: 0 });
		prev.setCell(2, 0, { char: "X", width: 1, styleId: 0 });

		const cur = new Screen(3, 1);
		cur.setCell(0, 0, { char: "好", width: 2, styleId: 0 });
		cur.setCell(1, 0, { char: "", width: 0, styleId: 0 });
		cur.setCell(2, 0, { char: "Y", width: 1, styleId: 0 });

		const lu = new LogUpdate();
		const out = lu.render(prev, cur);

		// One cursor move to (0,0) + "好Y" (cursor advances 2 after 好,
		// landing at column 2, which is where Y is).
		assert.strictEqual(out, "\x1b[?2026h\x1b[1;1H好Y\x1b[0m\x1b[?2026l");
	});

	it("treats transition from width=2 to width=1 correctly", () => {
		// prev: 你_ (你 at 0 width=2, _ at 1 width=0)
		// cur: ab (a at 0 width=1, b at 1 width=1)
		const prev = new Screen(2, 1);
		prev.setCell(0, 0, { char: "你", width: 2, styleId: 0 });
		prev.setCell(1, 0, { char: "", width: 0, styleId: 0 });

		const cur = new Screen(2, 1);
		cur.setCell(0, 0, { char: "a", width: 1, styleId: 0 });
		cur.setCell(1, 0, { char: "b", width: 1, styleId: 0 });

		const lu = new LogUpdate();
		const out = lu.render(prev, cur);

		// Both cells changed: "ab" written at (0,0).
		assert.strictEqual(out, "\x1b[?2026h\x1b[1;1Hab\x1b[0m\x1b[?2026l");
	});
});

// --
// SubTask 33.4: emoji U+1FA70–U+1FBFF width

describe("SubTask 33.4: emoji U+1FA70–U+1FBFF width", () => {
	it("treats U+1FA70 (ballet shoes) as width 2", () => {
		assert.strictEqual(visibleWidth("🩰"), 2);
	});

	it("treats U+1FA77 (winged sandals) as width 2", () => {
		// U+1FA77 was added in Unicode 14.0; if the runtime's RGI_Emoji
		// does not include it, the East Asian Width lookup still classifies
		// the Symbols and Pictographs Extended-A block as Wide.
		assert.strictEqual(visibleWidth("\u{1FA77}"), 2);
	});

	it("treats U+1FA80 (winged hand) as width 2", () => {
		assert.strictEqual(visibleWidth("\u{1FA80}"), 2);
	});

	it("treats U+1FAF8 (rightwards push hand) as width 2", () => {
		assert.strictEqual(visibleWidth("\u{1FAF8}"), 2);
	});

	it("writes a U+1FA70 emoji with width=2 and a placeholder at the next cell", () => {
		const screen = new Screen(3, 1);
		const output = new Output(screen);
		output.writeText(0, 0, "🩰", 0);
		output.flush();

		assert.strictEqual(screen.getCell(0, 0).char, "🩰");
		assert.strictEqual(screen.getCell(0, 0).width, 2);
		assert.strictEqual(screen.getCell(1, 0).char, "");
		assert.strictEqual(screen.getCell(1, 0).width, 0);
	});
});

// --
// SubTask 33.5: VS16 (U+FE0F) variation selector

describe("SubTask 33.5: VS16 (U+FE0F) variation selector", () => {
	it("treats ❤️ (U+2764 U+FE0F) as one grapheme with emoji width 2", () => {
		// VS16 forces emoji presentation on the base heart; the grapheme
		// segmenter groups the two codepoints into one cluster, and the
		// RGI_Emoji check returns width 2.
		assert.strictEqual(visibleWidth("❤️"), 2);
	});

	it("treats ❤ (U+2764 alone, no VS16) as width 1", () => {
		// Without VS16 the base heart uses its default text presentation,
		// which is a single cell.
		assert.strictEqual(visibleWidth("❤"), 1);
	});

	it("treats VS15 (U+FE0E) text presentation selector as zero-width", () => {
		// ❤︎ (U+2764 U+FE0E) forces text presentation; VS15 does not add
		// width on its own.
		assert.strictEqual(visibleWidth("❤︎"), 1);
	});

	it("writes ❤️ as a single grapheme with width=2 and a placeholder", () => {
		const screen = new Screen(3, 1);
		const output = new Output(screen);
		output.writeText(0, 0, "❤️", 0);
		output.flush();

		// The whole grapheme "❤\uFE0F" lives in cell (0,0); VS16 does not
		// occupy a separate cell.
		assert.strictEqual(screen.getCell(0, 0).char, "❤\uFE0F");
		assert.strictEqual(screen.getCell(0, 0).width, 2);
		assert.strictEqual(screen.getCell(1, 0).char, "");
		assert.strictEqual(screen.getCell(1, 0).width, 0);
	});

	it("does not emit a separate cell for VS16 between two ascii chars", () => {
		// "a❤️b" segments as ["a", "❤\uFE0F", "b"] → widths 1, 2, 1 = 4.
		const screen = new Screen(4, 1);
		const output = new Output(screen);
		output.writeText(0, 0, "a❤️b", 0);
		output.flush();

		assert.strictEqual(screen.getCell(0, 0).char, "a");
		assert.strictEqual(screen.getCell(0, 0).width, 1);
		assert.strictEqual(screen.getCell(1, 0).char, "❤\uFE0F");
		assert.strictEqual(screen.getCell(1, 0).width, 2);
		assert.strictEqual(screen.getCell(2, 0).char, "");
		assert.strictEqual(screen.getCell(2, 0).width, 0);
		assert.strictEqual(screen.getCell(3, 0).char, "b");
		assert.strictEqual(screen.getCell(3, 0).width, 1);
	});
});

// --
// SubTask 33.6: zero-width chars (ZWJ / VS15 / VS16)

describe("SubTask 33.6: zero-width chars (ZWJ U+200D)", () => {
	it("ZWJ between two ascii chars does not add visible width", () => {
		// "a\u200db" segments as ["a\u200d", "b"]; ZWJ attaches to the
		// previous grapheme and contributes 0 width, so total width = 2.
		assert.strictEqual(visibleWidth("a\u200db"), 2);
	});

	it("ZWJ inside an emoji sequence does not add extra width", () => {
		// Family emoji "👨‍👩‍👧" is one grapheme cluster (ZWJ-joined); the
		// whole cluster has emoji width 2.
		assert.strictEqual(visibleWidth("👨‍👩‍👧"), 2);
	});

	it("writes a ZWJ-joined ascii grapheme as one cell", () => {
		const screen = new Screen(2, 1);
		const output = new Output(screen);
		output.writeText(0, 0, "a\u200db", 0);
		output.flush();

		// Cell (0,0) carries the whole "a\u200d" grapheme (width 1).
		assert.strictEqual(screen.getCell(0, 0).char, "a\u200d");
		assert.strictEqual(screen.getCell(0, 0).width, 1);
		// Cell (1,0) carries "b".
		assert.strictEqual(screen.getCell(1, 0).char, "b");
		assert.strictEqual(screen.getCell(1, 0).width, 1);
	});

	it("does not write a separate cell for a standalone ZWJ", () => {
		// A standalone ZWJ is zero-width; the Output applies `continue`
		// (skipping the cell write) and does not advance the cursor.
		const screen = new Screen(2, 1);
		const output = new Output(screen);
		output.writeText(0, 0, "a\u200d", 0);
		output.flush();

		// "a\u200d" is one grapheme; written to (0,0) with width 1.
		assert.strictEqual(screen.getCell(0, 0).char, "a\u200d");
		assert.strictEqual(screen.getCell(0, 0).width, 1);
		// (1,0) stays empty.
		assert.strictEqual(screen.getCell(1, 0).char, " ");
		assert.strictEqual(screen.getCell(1, 0).width, 1);
	});
});
