/**
 * Task 28 tests — text selection and OSC 52 clipboard copy.
 *
 * Validates SelectionManager state machine (start/update/end), highlight
 * predicate for the rectangular selection region, and OSC 52 sequence
 * emission on selection end.
 *
 * Test runner: Node built-in `node --test`.
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import { LogUpdate } from "../src/diff/log-update.ts";
import { Screen } from "../src/screen/screen.ts";
import { SelectionManager } from "../src/selection.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

// --
// Helper: a minimal terminal that captures writes for OSC 52 verification.

class CapturingTerminal extends VirtualTerminal {
	readonly writes: string[] = [];

	constructor(cols = 20, rows = 10) {
		super(cols, rows);
	}

	write(data: string): void {
		this.writes.push(data);
		super.write(data);
	}

	clearWrites(): void {
		this.writes.length = 0;
	}

	/** Find the first OSC 52 sequence in captured writes, if any. */
	findOsc52(): string | undefined {
		for (const w of this.writes) {
			const idx = w.indexOf("\x1b]52;c;");
			if (idx !== -1) {
				const end = w.indexOf("\x07", idx);
				if (end !== -1) {
					return w.slice(idx, end + 1);
				}
			}
		}
		return undefined;
	}
}

// --
// State machine tests

describe("SelectionManager: state machine", () => {
	it("starts inactive", () => {
		const terminal = new CapturingTerminal();
		terminal.start(
			() => undefined,
			() => undefined,
		);
		const sm = new SelectionManager(terminal);
		assert.strictEqual(sm.isInSelectionMode(), false);
		terminal.stop();
	});

	it("startSelection activates selection mode", () => {
		const terminal = new CapturingTerminal();
		terminal.start(
			() => undefined,
			() => undefined,
		);
		const sm = new SelectionManager(terminal);
		sm.startSelection(3, 5);
		assert.strictEqual(sm.isInSelectionMode(), true);
		terminal.stop();
	});

	it("updateSelection is a no-op when not active", () => {
		const terminal = new CapturingTerminal();
		terminal.start(
			() => undefined,
			() => undefined,
		);
		const sm = new SelectionManager(terminal);
		sm.updateSelection(10, 10);
		assert.strictEqual(sm.isInSelectionMode(), false);
		// highlight predicate should be empty when not active
		const pred = sm.getHighlightPredicate();
		assert.strictEqual(pred(0, 0), false);
		terminal.stop();
	});

	it("updateSelection updates end coordinates when active", () => {
		const terminal = new CapturingTerminal();
		terminal.start(
			() => undefined,
			() => undefined,
		);
		const sm = new SelectionManager(terminal);
		sm.startSelection(0, 0);
		sm.updateSelection(5, 3);
		// Highlight region should cover (0,0) to (5,3)
		const pred = sm.getHighlightPredicate();
		assert.strictEqual(pred(0, 0), true);
		assert.strictEqual(pred(5, 3), true);
		assert.strictEqual(pred(3, 1), true);
		assert.strictEqual(pred(6, 0), false);
		assert.strictEqual(pred(0, 4), false);
		terminal.stop();
	});

	it("endSelection deactivates selection mode", () => {
		const terminal = new CapturingTerminal();
		terminal.start(
			() => undefined,
			() => undefined,
		);
		const sm = new SelectionManager(terminal);
		sm.startSelection(0, 0);
		sm.updateSelection(5, 3);
		sm.endSelection();
		assert.strictEqual(sm.isInSelectionMode(), false);
		// After end, highlight predicate should be empty
		const pred = sm.getHighlightPredicate();
		assert.strictEqual(pred(0, 0), false);
		terminal.stop();
	});
});

// --
// Highlight predicate / region tests

describe("SelectionManager: highlight predicate", () => {
	it("returns false for all cells when not active", () => {
		const terminal = new CapturingTerminal();
		terminal.start(
			() => undefined,
			() => undefined,
		);
		const sm = new SelectionManager(terminal);
		const pred = sm.getHighlightPredicate();
		for (let y = 0; y < 10; y++) {
			for (let x = 0; x < 20; x++) {
				assert.strictEqual(pred(x, y), false);
			}
		}
		terminal.stop();
	});

	it("covers a rectangular region from start to end", () => {
		const terminal = new CapturingTerminal();
		terminal.start(
			() => undefined,
			() => undefined,
		);
		const sm = new SelectionManager(terminal);
		sm.startSelection(2, 1);
		sm.updateSelection(6, 4);
		const pred = sm.getHighlightPredicate();
		// Inside rectangle
		for (let y = 1; y <= 4; y++) {
			for (let x = 2; x <= 6; x++) {
				assert.strictEqual(pred(x, y), true, `(${x},${y}) should be highlighted`);
			}
		}
		// Outside rectangle
		assert.strictEqual(pred(1, 1), false);
		assert.strictEqual(pred(7, 4), false);
		assert.strictEqual(pred(3, 0), false);
		assert.strictEqual(pred(3, 5), false);
		terminal.stop();
	});

	it("handles reversed start/end (drag up-left)", () => {
		const terminal = new CapturingTerminal();
		terminal.start(
			() => undefined,
			() => undefined,
		);
		const sm = new SelectionManager(terminal);
		sm.startSelection(6, 4);
		sm.updateSelection(2, 1);
		const pred = sm.getHighlightPredicate();
		// Same rectangle as above, just reversed direction
		for (let y = 1; y <= 4; y++) {
			for (let x = 2; x <= 6; x++) {
				assert.strictEqual(pred(x, y), true);
			}
		}
		terminal.stop();
	});

	it("getHighlightedRegion returns rows and cols", () => {
		const terminal = new CapturingTerminal();
		terminal.start(
			() => undefined,
			() => undefined,
		);
		const sm = new SelectionManager(terminal);
		sm.startSelection(1, 2);
		sm.updateSelection(3, 4);
		const region = sm.getHighlightedRegion();
		assert.ok(region !== null);
		assert.strictEqual(region.length, 3); // rows 2, 3, 4
		// Check row 2 has cols 1,2,3
		const row2 = region.find((r) => r.row === 2);
		assert.ok(row2 !== undefined);
		assert.deepStrictEqual(row2.cols, [1, 2, 3]);
		terminal.stop();
	});

	it("getHighlightedRegion returns null when not active", () => {
		const terminal = new CapturingTerminal();
		terminal.start(
			() => undefined,
			() => undefined,
		);
		const sm = new SelectionManager(terminal);
		assert.strictEqual(sm.getHighlightedRegion(), null);
		terminal.stop();
	});
});

// --
// OSC 52 clipboard copy tests

describe("SelectionManager: OSC 52 copy", () => {
	it("emits OSC 52 sequence on endSelection with non-empty selection", () => {
		const terminal = new CapturingTerminal(20, 5);
		terminal.start(
			() => undefined,
			() => undefined,
		);

		const screen = new Screen(20, 5);
		screen.writeText(0, 0, "Hello World", 0);
		screen.writeText(0, 1, "Second line", 0);

		const sm = new SelectionManager(terminal);
		sm.setScreen(screen);
		sm.startSelection(0, 0);
		sm.updateSelection(4, 0); // select "Hello"
		terminal.clearWrites();
		sm.endSelection();

		const osc52 = terminal.findOsc52();
		assert.ok(osc52 !== undefined, "should emit OSC 52 sequence");
		assert.ok(osc52.startsWith("\x1b]52;c;"), "should start with OSC 52 prefix");
		assert.ok(osc52.endsWith("\x07"), "should end with BEL");

		// Decode the base64 payload and verify content
		const payload = osc52.slice("\x1b]52;c;".length, -1);
		const decoded = Buffer.from(payload, "base64").toString("utf8");
		assert.strictEqual(decoded, "Hello");

		terminal.stop();
	});

	it("copies multi-line selection with newline separator", () => {
		const terminal = new CapturingTerminal(20, 5);
		terminal.start(
			() => undefined,
			() => undefined,
		);

		const screen = new Screen(20, 5);
		screen.writeText(0, 0, "Hello", 0);
		screen.writeText(0, 1, "World", 0);

		const sm = new SelectionManager(terminal);
		sm.setScreen(screen);
		sm.startSelection(0, 0);
		sm.updateSelection(4, 1); // select "Hello\nWorld"
		terminal.clearWrites();
		sm.endSelection();

		const osc52 = terminal.findOsc52();
		assert.ok(osc52 !== undefined);
		const payload = osc52.slice("\x1b]52;c;".length, -1);
		const decoded = Buffer.from(payload, "base64").toString("utf8");
		assert.strictEqual(decoded, "Hello\nWorld");

		terminal.stop();
	});

	it("trims trailing whitespace from each line", () => {
		const terminal = new CapturingTerminal(20, 5);
		terminal.start(
			() => undefined,
			() => undefined,
		);

		const screen = new Screen(20, 5);
		screen.writeText(0, 0, "Hi   ", 0); // "Hi" + 3 trailing spaces
		screen.writeText(0, 1, "There", 0);

		const sm = new SelectionManager(terminal);
		sm.setScreen(screen);
		sm.startSelection(0, 0);
		sm.updateSelection(19, 1); // select entire region
		terminal.clearWrites();
		sm.endSelection();

		const osc52 = terminal.findOsc52();
		assert.ok(osc52 !== undefined);
		const payload = osc52.slice("\x1b]52;c;".length, -1);
		const decoded = Buffer.from(payload, "base64").toString("utf8");
		assert.strictEqual(decoded, "Hi\nThere");

		terminal.stop();
	});

	it("does not emit OSC 52 when endSelection called without startSelection", () => {
		const terminal = new CapturingTerminal(20, 5);
		terminal.start(
			() => undefined,
			() => undefined,
		);

		const screen = new Screen(20, 5);
		screen.writeText(0, 0, "Hello", 0);

		const sm = new SelectionManager(terminal);
		sm.setScreen(screen);
		// Never called startSelection — no active selection
		terminal.clearWrites();
		sm.endSelection();

		const osc52 = terminal.findOsc52();
		assert.strictEqual(osc52, undefined);

		terminal.stop();
	});

	it("emits OSC 52 for single-cell selection", () => {
		const terminal = new CapturingTerminal(20, 5);
		terminal.start(
			() => undefined,
			() => undefined,
		);

		const screen = new Screen(20, 5);
		screen.writeText(0, 0, "Hello", 0);

		const sm = new SelectionManager(terminal);
		sm.setScreen(screen);
		sm.startSelection(2, 0);
		sm.updateSelection(2, 0); // single cell at col 2
		terminal.clearWrites();
		sm.endSelection();

		const osc52 = terminal.findOsc52();
		assert.ok(osc52 !== undefined, "single-cell selection should copy");
		const payload = osc52.slice("\x1b]52;c;".length, -1);
		const decoded = Buffer.from(payload, "base64").toString("utf8");
		assert.strictEqual(decoded, "l");

		terminal.stop();
	});

	it("does not emit OSC 52 when screen is null", () => {
		const terminal = new CapturingTerminal(20, 5);
		terminal.start(
			() => undefined,
			() => undefined,
		);

		const sm = new SelectionManager(terminal);
		// No setScreen call
		sm.startSelection(0, 0);
		sm.updateSelection(5, 0);
		terminal.clearWrites();
		sm.endSelection();

		const osc52 = terminal.findOsc52();
		assert.strictEqual(osc52, undefined);

		terminal.stop();
	});
});

// --
// LogUpdate integration: highlight applied during render

describe("SelectionManager: LogUpdate integration", () => {
	it("highlight predicate causes inverse style in rendered output", () => {
		const screen = new Screen(5, 1);
		screen.writeText(0, 0, "Hello", 0);

		const terminal = new CapturingTerminal(5, 1);
		terminal.start(
			() => undefined,
			() => undefined,
		);

		const sm = new SelectionManager(terminal);
		sm.startSelection(1, 0);
		sm.updateSelection(3, 0); // select "ell"

		const pred = sm.getHighlightPredicate();
		const lu = new LogUpdate();
		const out = lu.render(null, screen, pred);

		// The highlighted cells should have inverse SGR (\x1b[7m)
		assert.ok(out.includes("\x1b[7m"), `output should contain inverse SGR, got: ${JSON.stringify(out)}`);

		terminal.stop();
	});

	it("highlight works with incremental diff", () => {
		const prev = new Screen(5, 1);
		prev.writeText(0, 0, "Hello", 0);

		const cur = new Screen(5, 1);
		cur.writeText(0, 0, "Hello", 0);

		const terminal = new CapturingTerminal(5, 1);
		terminal.start(
			() => undefined,
			() => undefined,
		);

		const sm = new SelectionManager(terminal);
		sm.startSelection(0, 0);
		sm.updateSelection(4, 0); // select all "Hello"

		const pred = sm.getHighlightPredicate();
		const lu = new LogUpdate();
		// Even though prev and cur have the same text, the highlight should
		// cause cells to be re-rendered with inverse style.
		const out = lu.render(prev, cur, pred);

		assert.ok(out.includes("\x1b[7m"), `output should contain inverse SGR, got: ${JSON.stringify(out)}`);

		terminal.stop();
	});

	it("removing highlight re-renders cells without inverse", () => {
		const terminal = new CapturingTerminal(5, 1);
		terminal.start(
			() => undefined,
			() => undefined,
		);

		const sm = new SelectionManager(terminal);
		sm.setScreen(new Screen(5, 1));

		// Frame 1: with highlight
		const cur1 = new Screen(5, 1);
		cur1.writeText(0, 0, "Hello", 0);
		sm.startSelection(0, 0);
		sm.updateSelection(4, 0);
		const pred1 = sm.getHighlightPredicate();
		const lu = new LogUpdate();
		const out1 = lu.render(null, cur1, pred1);
		assert.ok(out1.includes("\x1b[7m"), "frame 1 should have inverse");

		// Frame 2: no highlight (selection ended)
		const cur2 = new Screen(5, 1);
		cur2.writeText(0, 0, "Hello", 0);
		// cur1 was mutated by applyHighlight — use it as prev
		const out2 = lu.render(cur1, cur2);
		// Should NOT contain inverse SGR (highlight was removed)
		assert.ok(!out2.includes("\x1b[7m"), `frame 2 should not have inverse, got: ${JSON.stringify(out2)}`);

		terminal.stop();
	});
});
