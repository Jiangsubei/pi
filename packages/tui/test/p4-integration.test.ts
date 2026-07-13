/**
 * P4 integration tests — Tasks 27 / 28 / 29 / 30 working together.
 *
 * Validates end-to-end integration of:
 *   - Task 27: Mouse event support (SGR parsing, hit-test, click synthesis)
 *   - Task 28: Text selection + OSC 52 clipboard copy (Alt+drag flow)
 *   - Task 29: Search highlight (set query → inverse → clear → restore)
 *   - Task 30: Bidirectional text (RTL run reordering through full pipeline)
 *
 * Six scenarios exercised through the TuiEngine + CapturingVirtualTerminal
 * pair so both the interpreted viewport (getViewport) and the raw ANSI byte
 * stream (writes) can be asserted on:
 *   1. Mouse click synthesis + event bubbling to an ancestor.
 *   2. stopPropagation on the click target halts bubbling.
 *   3. Alt+mousedown → mousemove → mouseup emits an OSC 52 clipboard copy
 *      containing the selected screen text.
 *   4. setSearchHighlight applies inverse style to matched cells, and
 *      clearSearchHighlight reverts the inverse on the next render.
 *   5. squashText reorders a mixed LTR+RTL string to visual order
 *      ("Hello مرحبا" → "Hello ابحرم").
 *   6. The reordered text reaches the terminal byte stream, confirming
 *      the full DOM → squash-text → paint → diff → output pipeline.
 *
 * Test runner: Node built-in `node --test`.
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import type { TuiElement } from "../src/dom/tree.ts";
import { TuiEngine } from "../src/engine.ts";
import { setKittyProtocolActive } from "../src/keys.ts";
import { squashText } from "../src/output/squash-text.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

// --
// Helpers

/**
 * VirtualTerminal subclass that captures every write for raw ANSI
 * inspection. The captured `writes` array lets OSC 52 and SGR tests
 * assert on the exact byte sequence the engine emitted.
 */
class CapturingVirtualTerminal extends VirtualTerminal {
	readonly writes: string[] = [];

	write(data: string): void {
		this.writes.push(data);
		super.write(data);
	}

	clearWrites(): void {
		this.writes.length = 0;
	}

	/** Find the first OSC 52 sequence in captured writes, if any. */
	findOsc52(): string | undefined {
		const all = this.writes.join("");
		const idx = all.indexOf("\x1b]52;c;");
		if (idx === -1) return undefined;
		const end = all.indexOf("\x07", idx);
		if (end === -1) return undefined;
		return all.slice(idx, end + 1);
	}
}

/** Create a capturing terminal + engine pair, started and ready. */
function setupEngine(cols = 20, rows = 10): { terminal: CapturingVirtualTerminal; engine: TuiEngine } {
	const terminal = new CapturingVirtualTerminal(cols, rows);
	terminal.start(
		() => undefined,
		() => undefined,
	);
	const engine = new TuiEngine(terminal);
	terminal.clearWrites();
	return { terminal, engine };
}

/**
 * Strip CSI / OSC / SS3 escape sequences from `s` so tests can assert on
 * the plain-text content of the terminal byte stream (e.g. to verify that
 * the bidi-reordered text reached the output).
 */
function stripAnsi(s: string): string {
	return s
		.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
		.replace(/\x1b\][0-9];[^\x07]*\x07/g, "")
		.replace(/\x1b[=>NOM]/g, "");
}

// --
// Scenario 1: mouse click + bubbling

describe("p4-integration: mouse click + bubbling", () => {
	it("synthesizes click after mousedown+mouseup and bubbles to ancestor", async () => {
		setKittyProtocolActive(false);
		const { terminal, engine } = setupEngine(20, 10);
		try {
			const parent = engine.createElement("ink-box", { width: 15, height: 8 });
			const child = engine.createElement("ink-box", { width: 5, height: 3 });
			engine.appendChild(parent, child);
			engine.appendChild(engine.rootNode, parent);
			engine.start();
			await terminal.waitForRender();

			let childClicks = 0;
			let parentClicks = 0;
			let clickTarget: TuiElement | null = null;
			child.addEventListener("click", (event) => {
				childClicks++;
				clickTarget = event.target;
			});
			parent.addEventListener("click", () => {
				parentClicks++;
			});

			// mousedown at 0-based (2,1) → SGR 1-based (3,2); inside child (0,0,5x3).
			engine.handleInput("\x1b[<0;3;2;M");
			// mouseup at same coordinate → synthesizes click on child.
			engine.handleInput("\x1b[<0;3;2;m");

			assert.strictEqual(childClicks, 1, "child click listener should fire once");
			assert.strictEqual(parentClicks, 1, "parent click listener should fire via bubbling");
			assert.strictEqual(clickTarget, child, "click target should be the child box");

			engine.stop();
		} finally {
			terminal.stop();
		}
	});

	it("stopPropagation on the click target prevents ancestor listener", async () => {
		setKittyProtocolActive(false);
		const { terminal, engine } = setupEngine(20, 10);
		try {
			const parent = engine.createElement("ink-box", { width: 15, height: 8 });
			const child = engine.createElement("ink-box", { width: 5, height: 3 });
			engine.appendChild(parent, child);
			engine.appendChild(engine.rootNode, parent);
			engine.start();
			await terminal.waitForRender();

			let childClicks = 0;
			let parentClicks = 0;
			child.addEventListener("click", (event) => {
				childClicks++;
				event.stopPropagation();
			});
			parent.addEventListener("click", () => {
				parentClicks++;
			});

			engine.handleInput("\x1b[<0;3;2;M");
			engine.handleInput("\x1b[<0;3;2;m");

			assert.strictEqual(childClicks, 1, "child listener should still fire on the target");
			assert.strictEqual(parentClicks, 0, "parent listener should NOT fire after stopPropagation");

			engine.stop();
		} finally {
			terminal.stop();
		}
	});
});

// --
// Scenario 2: Alt+drag text selection + OSC 52 clipboard copy

describe("p4-integration: Alt+drag selection + OSC 52", () => {
	it("emits OSC 52 with the selected text after Alt+drag", async () => {
		setKittyProtocolActive(false);
		const { terminal, engine } = setupEngine(20, 5);
		try {
			const text = engine.createText("Hello World");
			engine.appendChild(engine.rootNode, text);
			engine.start();
			await terminal.waitForRender();

			// Alt+left mousedown at 0-based (0,0) → SGR 1-based (1,1).
			// button = 0 (left) + 8 (alt) = 8, terminator M (press).
			engine.handleInput("\x1b[<8;1;1;M");
			// Alt+left mousemove (drag) to 0-based (4,0) → SGR 1-based (5,1).
			// button = 0 + 8 (alt) + 32 (motion) = 40, terminator M.
			engine.handleInput("\x1b[<40;5;1;M");
			// mouseup at 0-based (4,0) → SGR 1-based (5,1).
			// button = 0 + 8 (alt) = 8, terminator m (release).
			terminal.clearWrites();
			engine.handleInput("\x1b[<8;5;1;m");

			const osc52 = terminal.findOsc52();
			assert.ok(osc52 !== undefined, "should emit an OSC 52 sequence on selection end");
			assert.ok(osc52.startsWith("\x1b]52;c;"), "OSC 52 should start with the clipboard prefix");
			assert.ok(osc52.endsWith("\x07"), "OSC 52 should end with BEL");

			// The selection covers cols 0-4 on row 0: "Hello".
			const payload = osc52.slice("\x1b]52;c;".length, -1);
			const decoded = Buffer.from(payload, "base64").toString("utf8");
			assert.strictEqual(
				decoded,
				"Hello",
				`decoded OSC 52 payload should be "Hello", got: ${JSON.stringify(decoded)}`,
			);

			engine.stop();
		} finally {
			terminal.stop();
		}
	});
});

// --
// Scenario 3: search highlight (set query → inverse → clear → restore)

describe("p4-integration: search highlight", () => {
	it("applies inverse style to matched cells and clears on clearSearchHighlight", async () => {
		setKittyProtocolActive(false);
		const { terminal, engine } = setupEngine(20, 3);
		try {
			const text = engine.createText("hello world");
			engine.appendChild(engine.rootNode, text);
			engine.start();
			await terminal.waitForRender();

			// Frame with search highlight: "world" at cols 6-10 should get
			// inverse SGR (\x1b[7m) in the rendered output.
			terminal.clearWrites();
			engine.setSearchHighlight("world");
			await terminal.waitForRender();
			const highlightOutput = terminal.writes.join("");
			assert.ok(
				highlightOutput.includes("\x1b[7m"),
				`rendered output should contain inverse SGR for "world", got: ${JSON.stringify(highlightOutput)}`,
			);

			// Frame after clearing search: no cells should carry the inverse
			// SGR anymore (the diff reverts the style on the previously
			// highlighted cells).
			terminal.clearWrites();
			engine.clearSearchHighlight();
			await terminal.waitForRender();
			const clearedOutput = terminal.writes.join("");
			assert.ok(
				!clearedOutput.includes("\x1b[7m"),
				`rendered output should NOT contain inverse SGR after clearSearchHighlight, got: ${JSON.stringify(clearedOutput)}`,
			);

			engine.stop();
		} finally {
			terminal.stop();
		}
	});
});

// --
// Scenario 4: bidirectional text (mixed LTR + RTL)

describe("p4-integration: bidirectional text", () => {
	it("reorders mixed LTR+RTL text to visual order in squashText output", async () => {
		setKittyProtocolActive(false);
		const { terminal, engine } = setupEngine(20, 3);
		try {
			// Logical order: "Hello مرحبا" (H-e-l-l-o-space-m-r-h-b-a).
			// Visual order:  "Hello ابحرم" (LTR run kept, RTL run reversed).
			const text = engine.createText("Hello مرحبا");
			engine.appendChild(engine.rootNode, text);
			engine.start();
			await terminal.waitForRender();

			const segments = squashText(text);
			assert.strictEqual(segments.length, 1, "should produce one styled segment");
			assert.strictEqual(
				segments[0]!.text,
				"Hello ابحرم",
				`squashText should reorder RTL run to visual order, got: ${JSON.stringify(segments[0]!.text)}`,
			);

			engine.stop();
		} finally {
			terminal.stop();
		}
	});

	it("delivers the reordered text to the terminal byte stream", async () => {
		setKittyProtocolActive(false);
		const { terminal, engine } = setupEngine(20, 3);
		try {
			const text = engine.createText("Hello مرحبا");
			engine.appendChild(engine.rootNode, text);
			engine.start();
			await terminal.waitForRender();

			// The engine writes the visual-order text to the terminal.
			// After stripping ANSI escape sequences, the byte stream
			// should contain "Hello ابحرم" as a contiguous substring.
			const raw = terminal.writes.join("");
			const plain = stripAnsi(raw);
			assert.ok(
				plain.includes("Hello ابحرم"),
				`terminal byte stream should contain visual-order text "Hello ابحرم", got: ${JSON.stringify(plain.slice(0, 60))}`,
			);

			engine.stop();
		} finally {
			terminal.stop();
		}
	});
});
