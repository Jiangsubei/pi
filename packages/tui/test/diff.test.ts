import assert from "node:assert";
import { describe, it } from "node:test";
import { LogUpdate } from "../src/diff/log-update.ts";
import { applyTextStyles } from "../src/output/colorize.ts";
import { Screen } from "../src/screen/screen.ts";

// --
// Test 1: First frame full render (prev=null)

describe("LogUpdate: first frame (prev=null)", () => {
	it("emits BSU + HOME + all cells + RESET + ESU", () => {
		const screen = new Screen(3, 1);
		screen.writeText(0, 0, "ABC", 0);
		const lu = new LogUpdate();
		const out = lu.render(null, screen);
		assert.strictEqual(out, "\x1b[?2026h\x1b[HABC\x1b[0m\x1b[?2026l");
	});

	it("emits row cursor moves for rows after the first", () => {
		const screen = new Screen(2, 2);
		screen.writeText(0, 0, "AB", 0);
		screen.writeText(0, 1, "CD", 0);
		const lu = new LogUpdate();
		const out = lu.render(null, screen);
		// HOME + "AB" + cursor to row 2 col 1 + "CD" + RESET
		assert.strictEqual(out, "\x1b[?2026h\x1b[HAB\x1b[2;1HCD\x1b[0m\x1b[?2026l");
	});
});

// --
// Test 2: Incremental diff

describe("LogUpdate: incremental diff", () => {
	it("emits only changed cells with cursor move", () => {
		const prev = new Screen(3, 1);
		prev.writeText(0, 0, "ABC", 0);
		const cur = new Screen(3, 1);
		cur.writeText(0, 0, "AXC", 0);
		const lu = new LogUpdate();
		const out = lu.render(prev, cur);
		// BSU + cursor to (1,0) [1-indexed: 1;2H] + "X" + RESET + ESU
		assert.strictEqual(out, "\x1b[?2026h\x1b[1;2HX\x1b[0m\x1b[?2026l");
	});
});

// --
// Test 3: No changes

describe("LogUpdate: no changes", () => {
	it("emits BSU + ESU with empty body", () => {
		const prev = new Screen(3, 1);
		prev.writeText(0, 0, "ABC", 0);
		const cur = prev.clone();
		const lu = new LogUpdate();
		const out = lu.render(prev, cur);
		assert.strictEqual(out, "\x1b[?2026h\x1b[?2026l");
	});
});

// --
// Test 4: Damage region merging

describe("LogUpdate: damage region merging", () => {
	it("merges consecutive x changes in the same row into one cursor move", () => {
		const prev = new Screen(5, 1);
		prev.writeText(0, 0, "ABCDE", 0);
		const cur = new Screen(5, 1);
		cur.writeText(0, 0, "AXYDE", 0);
		const lu = new LogUpdate();
		const out = lu.render(prev, cur);
		// One cursor move to (1,0) [1;2H] + "XY" + RESET
		assert.strictEqual(out, "\x1b[?2026h\x1b[1;2HXY\x1b[0m\x1b[?2026l");
	});

	it("uses separate cursor moves for non-consecutive changes", () => {
		const prev = new Screen(5, 1);
		prev.writeText(0, 0, "ABCDE", 0);
		const cur = new Screen(5, 1);
		cur.writeText(0, 0, "XBCYE", 0);
		const lu = new LogUpdate();
		const out = lu.render(prev, cur);
		// Two cursor moves: (0,0) [1;1H] and (3,0) [1;4H]
		assert.strictEqual(out, "\x1b[?2026h\x1b[1;1HX\x1b[1;4HY\x1b[0m\x1b[?2026l");
	});

	it("merges changes across multiple rows", () => {
		const prev = new Screen(3, 2);
		prev.writeText(0, 0, "ABC", 0);
		prev.writeText(0, 1, "DEF", 0);
		const cur = new Screen(3, 2);
		cur.writeText(0, 0, "AXC", 0);
		cur.writeText(0, 1, "DYF", 0);
		const lu = new LogUpdate();
		const out = lu.render(prev, cur);
		// Row 0: cursor to (1,0) + "X"
		// Row 1: cursor to (1,1) + "Y"
		assert.strictEqual(out, "\x1b[?2026h\x1b[1;2HX\x1b[2;2HY\x1b[0m\x1b[?2026l");
	});
});

// --
// Test 5: Scroll hint detection (DECSTBM)

describe("LogUpdate: scroll hint (DECSTBM)", () => {
	it("detects upward scroll and emits DECSTBM sequence", () => {
		const prev = new Screen(1, 4);
		prev.writeText(0, 0, "A", 0);
		prev.writeText(0, 1, "B", 0);
		prev.writeText(0, 2, "C", 0);
		prev.writeText(0, 3, "D", 0);
		const cur = new Screen(1, 4);
		cur.writeText(0, 0, "C", 0);
		cur.writeText(0, 1, "D", 0);
		cur.writeText(0, 2, "E", 0);
		cur.writeText(0, 3, "F", 0);
		const lu = new LogUpdate();
		const out = lu.render(prev, cur);

		// DECSTBM: set region [1;4] + scroll up 2 + reset region
		assert.ok(out.includes("\x1b[1;4r"), `should set scroll region, got: ${JSON.stringify(out)}`);
		assert.ok(out.includes("\x1b[2S"), `should scroll up 2, got: ${JSON.stringify(out)}`);
		assert.ok(out.includes("\x1b[r"), `should reset scroll region, got: ${JSON.stringify(out)}`);

		// Should render new rows E and F (at y=2 and y=3)
		assert.ok(out.includes("E"), `should render E, got: ${JSON.stringify(out)}`);
		assert.ok(out.includes("F"), `should render F, got: ${JSON.stringify(out)}`);

		// Should NOT re-render C and D (they were scrolled, not changed)
		// Count content chars: only E and F should appear as new writes
		const cursorMoves = out.match(/\x1b\[\d+;\d+H/g);
		assert.ok(cursorMoves !== null, "should have cursor moves");
		assert.strictEqual(
			cursorMoves.length,
			2,
			`should have 2 cursor moves for 2 new rows, got: ${cursorMoves.length}`,
		);
	});

	it("falls back to normal diff when no scroll detected", () => {
		const prev = new Screen(3, 1);
		prev.writeText(0, 0, "ABC", 0);
		const cur = new Screen(3, 1);
		cur.writeText(0, 0, "XYZ", 0);
		const lu = new LogUpdate();
		const out = lu.render(prev, cur);
		// No DECSTBM sequence — all 3 cells changed, no y-shift relationship
		assert.ok(!out.includes("\x1b[1;1r"), `should not emit DECSTBM, got: ${JSON.stringify(out)}`);
		assert.ok(out.includes("XYZ"), `should render XYZ, got: ${JSON.stringify(out)}`);
	});
});

// --
// Test 6: Style switching (full SGR via applyTextStyles)

describe("LogUpdate: style switching", () => {
	it("emits reset + applyTextStyles on styleId change in full frame", () => {
		const screen = new Screen(2, 1);
		const boldRed = screen.stylePool.add({ bold: true, color: "ansi:red" });
		screen.setCell(0, 0, { char: "A", width: 1, styleId: 0 });
		screen.setCell(1, 0, { char: "B", width: 1, styleId: boldRed });
		const lu = new LogUpdate();
		const out = lu.render(null, screen);
		// A: styleId=0 (no transition from initial 0)
		// B: styleId=boldRed (transition: reset + bold + red fg)
		const expectedStyleAnsi = `\x1b[0m${applyTextStyles({ bold: true, color: "ansi:red" })}`;
		assert.ok(
			out.includes(expectedStyleAnsi),
			`expected output to contain style ANSI "${JSON.stringify(expectedStyleAnsi)}", got: ${JSON.stringify(out)}`,
		);
		// Should end with RESET before ESU
		assert.ok(out.endsWith("\x1b[0m\x1b[?2026l"), `should end with RESET+ESU, got: ${JSON.stringify(out)}`);
	});

	it("emits style transition in incremental diff", () => {
		const prev = new Screen(2, 1);
		prev.writeText(0, 0, "AB", 0);
		const cur = new Screen(2, 1);
		const red = cur.stylePool.add({ color: "ansi:red" });
		cur.setCell(0, 0, { char: "A", width: 1, styleId: 0 });
		cur.setCell(1, 0, { char: "B", width: 1, styleId: red });
		const lu = new LogUpdate();
		const out = lu.render(prev, cur);
		// Only (1,0) changed (styleId 0 → red)
		const expectedStyleAnsi = `\x1b[0m${applyTextStyles({ color: "ansi:red" })}`;
		assert.ok(out.includes(expectedStyleAnsi), `should contain red style transition, got: ${JSON.stringify(out)}`);
	});
});

// --
// Test 7: Wide character handling

describe("LogUpdate: wide characters", () => {
	it("skips width=0 trailing cells in full frame", () => {
		const screen = new Screen(3, 1);
		screen.setCell(0, 0, { char: "\u65e5", width: 2, styleId: 0 });
		screen.setCell(1, 0, { char: "", width: 0, styleId: 0 });
		screen.setCell(2, 0, { char: "X", width: 1, styleId: 0 });
		const lu = new LogUpdate();
		const out = lu.render(null, screen);
		// Should write \u65e5 then X, no extra space for width=0
		assert.strictEqual(out, "\x1b[?2026h\x1b[H\u65e5X\x1b[0m\x1b[?2026l");
	});

	it("skips width=0 cells in diff without extra cursor moves", () => {
		const prev = new Screen(3, 1);
		prev.writeText(0, 0, "ABC", 0);
		const cur = new Screen(3, 1);
		cur.setCell(0, 0, { char: "\u65e5", width: 2, styleId: 0 });
		cur.setCell(1, 0, { char: "", width: 0, styleId: 0 });
		cur.setCell(2, 0, { char: "C", width: 1, styleId: 0 });
		const lu = new LogUpdate();
		const out = lu.render(prev, cur);
		// (0,0) and (1,0) changed; (1,0) is width=0 so skipped
		// (2,0) unchanged (C==C)
		// Write \u65e5 at (0,0), cursor advances to (2,0)
		assert.strictEqual(out, "\x1b[?2026h\x1b[1;1H\u65e5\x1b[0m\x1b[?2026l");
	});
});

// --
// Test 8: Style consistency (styleCache behavior)

describe("LogUpdate: style consistency", () => {
	it("produces correct ANSI for cells with the same styleId across transitions", () => {
		const screen = new Screen(4, 1);
		const red = screen.stylePool.add({ color: "ansi:red" });
		screen.setCell(0, 0, { char: "A", width: 1, styleId: red });
		screen.setCell(1, 0, { char: "B", width: 1, styleId: red });
		screen.setCell(2, 0, { char: "C", width: 1, styleId: 0 });
		screen.setCell(3, 0, { char: "D", width: 1, styleId: red });
		const lu = new LogUpdate();
		const out = lu.render(null, screen);
		// Transitions: 0→red (A), red→red (B, no transition), red→0 (C), 0→red (D)
		const redAnsi = `\x1b[0m${applyTextStyles({ color: "ansi:red" })}`;
		// red style ANSI should appear twice (for A and D)
		let count = 0;
		let idx = out.indexOf(redAnsi);
		while (idx !== -1) {
			count++;
			idx = out.indexOf(redAnsi, idx + 1);
		}
		assert.strictEqual(count, 2, `expected red style ANSI to appear twice, got ${count} in ${JSON.stringify(out)}`);
	});

	it("does not emit style transition for consecutive same-styleId cells", () => {
		const screen = new Screen(3, 1);
		const red = screen.stylePool.add({ color: "ansi:red" });
		screen.setCell(0, 0, { char: "A", width: 1, styleId: red });
		screen.setCell(1, 0, { char: "B", width: 1, styleId: red });
		screen.setCell(2, 0, { char: "C", width: 1, styleId: red });
		const lu = new LogUpdate();
		const out = lu.render(null, screen);
		// Only one style transition (at the first cell), then no more
		const redAnsi = `\x1b[0m${applyTextStyles({ color: "ansi:red" })}`;
		let count = 0;
		let idx = out.indexOf(redAnsi);
		while (idx !== -1) {
			count++;
			idx = out.indexOf(redAnsi, idx + 1);
		}
		assert.strictEqual(count, 1, `expected style transition once, got ${count} in ${JSON.stringify(out)}`);
	});
});

// --
// Test 9: Dimension change triggers full repaint

describe("LogUpdate: dimension change", () => {
	it("emits clear screen + full repaint on width change", () => {
		const prev = new Screen(3, 1);
		prev.writeText(0, 0, "ABC", 0);
		const cur = new Screen(2, 1);
		cur.writeText(0, 0, "XY", 0);
		const lu = new LogUpdate();
		const out = lu.render(prev, cur);
		assert.ok(out.includes("\x1b[2J"), `should clear screen, got: ${JSON.stringify(out)}`);
		assert.ok(out.includes("\x1b[H"), `should home cursor, got: ${JSON.stringify(out)}`);
		assert.ok(out.includes("XY"), `should render new content, got: ${JSON.stringify(out)}`);
	});

	it("emits clear screen on height change", () => {
		const prev = new Screen(2, 2);
		prev.writeText(0, 0, "AB", 0);
		prev.writeText(0, 1, "CD", 0);
		const cur = new Screen(2, 1);
		cur.writeText(0, 0, "XY", 0);
		const lu = new LogUpdate();
		const out = lu.render(prev, cur);
		assert.ok(out.includes("\x1b[2J"), `should clear screen, got: ${JSON.stringify(out)}`);
	});
});
