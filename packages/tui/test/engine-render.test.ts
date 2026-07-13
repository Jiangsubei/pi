/**
 * P1 integration tests — end-to-end validation of the full pipeline:
 *   create DOM -> calculate layout -> paint to Screen -> diff output
 *
 * These tests exercise the TuiEngine through the VirtualTerminal,
 * verifying both the interpreted viewport (via getViewport) and the
 * raw ANSI output (via CapturingVirtualTerminal.writes) to cover
 * visual content, SGR styling, diff sequences, and DECSTBM scroll
 * hints.
 *
 * Six scenarios:
 *   1. Five cli-boxes border styles (round/single/double/dashed/bold)
 *   2. Text styles (fg/bg/bold/italic/underline/inverse/strikethrough/dim)
 *   3. Text wrap modes (wrap/truncate/truncate-end)
 *   4. Double-buffer diff (full/incremental/BSU-ESU wrapper/empty)
 *   5. DECSTBM scroll hint
 *   6. Complex layouts (nested+inherit/row flexbox/column+flexGrow)
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import type { BorderStyle } from "../src/dom/types.ts";
import { TuiEngine } from "../src/engine.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

// --
// Helpers

/**
 * VirtualTerminal subclass that captures every write for raw ANSI
 * inspection. The captured `writes` array lets diff / DECSTBM / SGR
 * tests assert on the exact byte sequence the engine emitted, not
 * just the interpreted viewport.
 */
class CapturingVirtualTerminal extends VirtualTerminal {
	readonly writes: string[] = [];

	write(data: string): void {
		this.writes.push(data);
		super.write(data);
	}

	/** Clear captured writes (e.g. after setup to skip bracketed-paste). */
	clearWrites(): void {
		this.writes.length = 0;
	}
}

/** Create a capturing terminal + engine pair, started and ready. */
function setupEngine(cols = 80, rows = 24): { terminal: CapturingVirtualTerminal; engine: TuiEngine } {
	const terminal = new CapturingVirtualTerminal(cols, rows);
	terminal.start(
		() => undefined,
		() => undefined,
	);
	const engine = new TuiEngine(terminal);
	terminal.clearWrites();
	return { terminal, engine };
}

/** Safely extract a character at (x, y) from a viewport. Returns " " for trimmed or out-of-bounds positions. */
function charAt(viewport: string[], x: number, y: number): string {
	const line = viewport[y];
	if (!line || x >= line.length) return " ";
	return line[x]!;
}

// --
// Scenario 1: Border styles (round/single/double/dashed/bold)

describe("engine-render: border styles", () => {
	const cases: Array<{
		style: BorderStyle;
		tl: string;
		tr: string;
		bl: string;
		br: string;
		h: string;
		v: string;
	}> = [
		{ style: "round", tl: "\u256d", tr: "\u256e", bl: "\u2570", br: "\u256f", h: "\u2500", v: "\u2502" },
		{ style: "single", tl: "\u250c", tr: "\u2510", bl: "\u2514", br: "\u2518", h: "\u2500", v: "\u2502" },
		{ style: "double", tl: "\u2554", tr: "\u2557", bl: "\u255a", br: "\u255d", h: "\u2550", v: "\u2551" },
		{ style: "dashed", tl: " ", tr: " ", bl: " ", br: " ", h: "\u254c", v: "\u254e" },
		{ style: "bold", tl: "\u250f", tr: "\u2513", bl: "\u2517", br: "\u251b", h: "\u2501", v: "\u2503" },
	];

	for (const { style, tl, tr, bl, br, h, v } of cases) {
		it(`renders ${style} border with correct characters`, async () => {
			const { terminal, engine } = setupEngine(10, 5);
			const box = engine.createElement("ink-box", {
				borderStyle: style,
				width: 6,
				height: 3,
			});
			engine.appendChild(engine.rootNode, box);
			engine.start();
			await terminal.waitForRender();
			const viewport = terminal.getViewport();
			assert.strictEqual(charAt(viewport, 0, 0), tl, `top-left corner for ${style}`);
			assert.strictEqual(charAt(viewport, 5, 0), tr, `top-right corner for ${style}`);
			assert.strictEqual(charAt(viewport, 0, 2), bl, `bottom-left corner for ${style}`);
			assert.strictEqual(charAt(viewport, 5, 2), br, `bottom-right corner for ${style}`);
			assert.strictEqual(charAt(viewport, 1, 0), h, `top edge for ${style}`);
			assert.strictEqual(charAt(viewport, 0, 1), v, `left edge for ${style}`);
			engine.stop();
			terminal.stop();
		});
	}
});

// --
// Scenario 2: Text styles (fg/bg/bold/italic/underline/inverse/strikethrough/dim)

describe("engine-render: text styles", () => {
	it("renders text with foreground color (ansi:red)", async () => {
		const { terminal, engine } = setupEngine(10, 3);
		const text = engine.createText("Red", { color: "ansi:red" });
		engine.appendChild(engine.rootNode, text);
		engine.start();
		await terminal.waitForRender();
		const output = terminal.writes.join("");
		assert.ok(output.includes("\x1b[31m"), `should contain red fg SGR, got: ${JSON.stringify(output)}`);
		engine.stop();
		terminal.stop();
	});

	it("renders text with background color (ansi:blue)", async () => {
		const { terminal, engine } = setupEngine(10, 3);
		const text = engine.createText("Bg", { backgroundColor: "ansi:blue" });
		engine.appendChild(engine.rootNode, text);
		engine.start();
		await terminal.waitForRender();
		const output = terminal.writes.join("");
		assert.ok(output.includes("\x1b[44m"), `should contain blue bg SGR, got: ${JSON.stringify(output)}`);
		engine.stop();
		terminal.stop();
	});

	it("renders text with bold", async () => {
		const { terminal, engine } = setupEngine(10, 3);
		const text = engine.createText("Bold", { bold: true });
		engine.appendChild(engine.rootNode, text);
		engine.start();
		await terminal.waitForRender();
		const output = terminal.writes.join("");
		assert.ok(output.includes("\x1b[1m"), `should contain bold SGR, got: ${JSON.stringify(output)}`);
		engine.stop();
		terminal.stop();
	});

	it("renders text with italic", async () => {
		const { terminal, engine } = setupEngine(10, 3);
		const text = engine.createText("Ital", { italic: true });
		engine.appendChild(engine.rootNode, text);
		engine.start();
		await terminal.waitForRender();
		const output = terminal.writes.join("");
		assert.ok(output.includes("\x1b[3m"), `should contain italic SGR, got: ${JSON.stringify(output)}`);
		engine.stop();
		terminal.stop();
	});

	it("renders text with underline", async () => {
		const { terminal, engine } = setupEngine(10, 3);
		const text = engine.createText("Under", { underline: true });
		engine.appendChild(engine.rootNode, text);
		engine.start();
		await terminal.waitForRender();
		const output = terminal.writes.join("");
		assert.ok(output.includes("\x1b[4m"), `should contain underline SGR, got: ${JSON.stringify(output)}`);
		engine.stop();
		terminal.stop();
	});

	it("renders text with inverse", async () => {
		const { terminal, engine } = setupEngine(10, 3);
		const text = engine.createText("Inv", { inverse: true });
		engine.appendChild(engine.rootNode, text);
		engine.start();
		await terminal.waitForRender();
		const output = terminal.writes.join("");
		assert.ok(output.includes("\x1b[7m"), `should contain inverse SGR, got: ${JSON.stringify(output)}`);
		engine.stop();
		terminal.stop();
	});

	it("renders text with strikethrough", async () => {
		const { terminal, engine } = setupEngine(10, 3);
		const text = engine.createText("Strike", { strikethrough: true });
		engine.appendChild(engine.rootNode, text);
		engine.start();
		await terminal.waitForRender();
		const output = terminal.writes.join("");
		assert.ok(output.includes("\x1b[9m"), `should contain strikethrough SGR, got: ${JSON.stringify(output)}`);
		engine.stop();
		terminal.stop();
	});

	it("renders text with dim", async () => {
		const { terminal, engine } = setupEngine(10, 3);
		const text = engine.createText("Dim", { dim: true });
		engine.appendChild(engine.rootNode, text);
		engine.start();
		await terminal.waitForRender();
		const output = terminal.writes.join("");
		assert.ok(output.includes("\x1b[2m"), `should contain dim SGR, got: ${JSON.stringify(output)}`);
		engine.stop();
		terminal.stop();
	});
});

// --
// Scenario 3: Text wrap modes (wrap/truncate/truncate-end)

describe("engine-render: text wrap modes", () => {
	it("wraps text to multiple lines", async () => {
		const { terminal, engine } = setupEngine(10, 5);
		const text = engine.createText("Hello World", { textWrap: "wrap", width: 5 });
		engine.appendChild(engine.rootNode, text);
		engine.start();
		await terminal.waitForRender();
		const viewport = terminal.getViewport();
		assert.ok(
			viewport[0]!.startsWith("Hello"),
			`row 0 should start with "Hello", got: ${JSON.stringify(viewport[0])}`,
		);
		assert.ok(
			viewport[1]!.startsWith("World"),
			`row 1 should start with "World", got: ${JSON.stringify(viewport[1])}`,
		);
		engine.stop();
		terminal.stop();
	});

	it("truncates text with ellipsis", async () => {
		const { terminal, engine } = setupEngine(10, 3);
		const text = engine.createText("Hello World", { textWrap: "truncate", width: 5 });
		engine.appendChild(engine.rootNode, text);
		engine.start();
		await terminal.waitForRender();
		const viewport = terminal.getViewport();
		assert.ok(
			viewport[0]!.startsWith("Hell\u2026"),
			`row 0 should start with "Hell\u2026", got: ${JSON.stringify(viewport[0])}`,
		);
		engine.stop();
		terminal.stop();
	});

	it("truncate-end produces same result as truncate", async () => {
		const { terminal, engine } = setupEngine(10, 3);
		const text = engine.createText("Hello World", { textWrap: "truncate-end", width: 5 });
		engine.appendChild(engine.rootNode, text);
		engine.start();
		await terminal.waitForRender();
		const viewport = terminal.getViewport();
		assert.ok(
			viewport[0]!.startsWith("Hell\u2026"),
			`truncate-end should produce "Hell\u2026", got: ${JSON.stringify(viewport[0])}`,
		);
		engine.stop();
		terminal.stop();
	});
});

// --
// Scenario 4: Double-buffer diff (full/incremental/BSU-ESU wrapper/empty)

describe("engine-render: diff rendering", () => {
	it("emits full repaint on first frame (prev=null)", async () => {
		const { terminal, engine } = setupEngine(5, 1);
		const text = engine.createText("Hello");
		engine.appendChild(engine.rootNode, text);
		engine.start();
		await terminal.waitForRender();
		const output = terminal.writes[0]!;
		assert.ok(output.startsWith("\x1b[?2026h"), `should start with BSU, got: ${JSON.stringify(output)}`);
		assert.ok(output.includes("\x1b[H"), `should contain HOME, got: ${JSON.stringify(output)}`);
		assert.ok(output.includes("Hello"), `should contain text, got: ${JSON.stringify(output)}`);
		assert.ok(output.endsWith("\x1b[0m\x1b[?2026l"), `should end with RESET+ESU, got: ${JSON.stringify(output)}`);
		engine.stop();
		terminal.stop();
	});

	it("emits incremental diff on content change", async () => {
		const { terminal, engine } = setupEngine(5, 1);
		const text = engine.createText("Hello");
		engine.appendChild(engine.rootNode, text);
		engine.start();
		await terminal.waitForRender();
		terminal.clearWrites();
		text.textContent = "Xello";
		engine.requestRender();
		await terminal.waitForRender();
		const output = terminal.writes[0]!;
		assert.ok(output.startsWith("\x1b[?2026h"), `should start with BSU, got: ${JSON.stringify(output)}`);
		assert.ok(output.includes("\x1b[1;1H"), `should contain CUP to (0,0), got: ${JSON.stringify(output)}`);
		assert.ok(output.includes("X"), `should contain changed char, got: ${JSON.stringify(output)}`);
		assert.ok(!output.includes("Hello"), `should not contain old text, got: ${JSON.stringify(output)}`);
		assert.ok(output.endsWith("\x1b[0m\x1b[?2026l"), `should end with RESET+ESU, got: ${JSON.stringify(output)}`);
		engine.stop();
		terminal.stop();
	});

	it("wraps all output in BSU/ESU guards", async () => {
		const { terminal, engine } = setupEngine(5, 1);
		const text = engine.createText("Hi");
		engine.appendChild(engine.rootNode, text);
		engine.start();
		await terminal.waitForRender();
		const output = terminal.writes[0]!;
		assert.ok(output.startsWith("\x1b[?2026h"), "should start with BSU");
		assert.ok(output.endsWith("\x1b[?2026l"), "should end with ESU");
		const bsuCount = (output.match(/\x1b\[\?2026h/g) || []).length;
		const esuCount = (output.match(/\x1b\[\?2026l/g) || []).length;
		assert.strictEqual(bsuCount, 1, `should have exactly 1 BSU, got ${bsuCount}`);
		assert.strictEqual(esuCount, 1, `should have exactly 1 ESU, got ${esuCount}`);
		engine.stop();
		terminal.stop();
	});

	it("emits BSU+ESU only when nothing changed", async () => {
		const { terminal, engine } = setupEngine(5, 1);
		const text = engine.createText("Hello");
		engine.appendChild(engine.rootNode, text);
		engine.start();
		await terminal.waitForRender();
		terminal.clearWrites();
		engine.requestRender();
		await terminal.waitForRender();
		const output = terminal.writes[0]!;
		assert.strictEqual(output, "\x1b[?2026h\x1b[?2026l", `should be BSU+ESU only, got: ${JSON.stringify(output)}`);
		engine.stop();
		terminal.stop();
	});
});

// --
// Scenario 5: DECSTBM scroll hint

describe("engine-render: scroll hint", () => {
	it("emits DECSTBM sequence on vertical content shift", async () => {
		const { terminal, engine } = setupEngine(1, 4);
		const t1 = engine.createText("A");
		const t2 = engine.createText("B");
		const t3 = engine.createText("C");
		const t4 = engine.createText("D");
		engine.appendChild(engine.rootNode, t1);
		engine.appendChild(engine.rootNode, t2);
		engine.appendChild(engine.rootNode, t3);
		engine.appendChild(engine.rootNode, t4);
		engine.start();
		await terminal.waitForRender();
		terminal.clearWrites();
		engine.removeChild(engine.rootNode, t1);
		engine.removeChild(engine.rootNode, t2);
		const t5 = engine.createText("E");
		const t6 = engine.createText("F");
		engine.appendChild(engine.rootNode, t5);
		engine.appendChild(engine.rootNode, t6);
		engine.requestRender();
		await terminal.waitForRender();
		const output = terminal.writes[0]!;
		assert.ok(output.includes("\x1b[1;4r"), `should set scroll region [1;4], got: ${JSON.stringify(output)}`);
		assert.ok(output.includes("\x1b[2S"), `should scroll up 2, got: ${JSON.stringify(output)}`);
		assert.ok(output.includes("\x1b[r"), `should reset scroll region, got: ${JSON.stringify(output)}`);
		assert.ok(output.includes("E"), `should render E, got: ${JSON.stringify(output)}`);
		assert.ok(output.includes("F"), `should render F, got: ${JSON.stringify(output)}`);
		const viewport = terminal.getViewport();
		assert.strictEqual(viewport[0], "C", `row 0 should be C, got: ${JSON.stringify(viewport[0])}`);
		assert.strictEqual(viewport[1], "D", `row 1 should be D, got: ${JSON.stringify(viewport[1])}`);
		assert.strictEqual(viewport[2], "E", `row 2 should be E, got: ${JSON.stringify(viewport[2])}`);
		assert.strictEqual(viewport[3], "F", `row 3 should be F, got: ${JSON.stringify(viewport[3])}`);
		engine.stop();
		terminal.stop();
	});
});

// --
// Scenario 6: Complex layouts (nested+inherit/row flexbox/column+flexGrow)

describe("engine-render: complex layouts", () => {
	it("renders nested boxes with inherited styles", async () => {
		const { terminal, engine } = setupEngine(20, 10);
		const outer = engine.createElement("ink-box", {
			borderStyle: "round",
			flexDirection: "column",
			width: 10,
			height: 5,
			color: "ansi:red",
		});
		const inner = engine.createText("Hi", { bold: true });
		engine.appendChild(outer, inner);
		engine.appendChild(engine.rootNode, outer);
		engine.start();
		await terminal.waitForRender();
		const viewport = terminal.getViewport();
		assert.strictEqual(charAt(viewport, 0, 0), "\u256d", `top-left should be ╭, got: ${JSON.stringify(viewport[0])}`);
		assert.strictEqual(
			charAt(viewport, 9, 0),
			"\u256e",
			`top-right should be ╮, got: ${JSON.stringify(viewport[0])}`,
		);
		assert.strictEqual(charAt(viewport, 1, 1), "H", `should find H at (1,1), got: ${JSON.stringify(viewport[1])}`);
		assert.strictEqual(charAt(viewport, 2, 1), "i", `should find i at (2,1), got: ${JSON.stringify(viewport[1])}`);
		const output = terminal.writes.join("");
		assert.ok(
			output.includes("\x1b[31m"),
			`should contain red fg (inherited from box), got: ${JSON.stringify(output)}`,
		);
		assert.ok(output.includes("\x1b[1m"), `should contain bold SGR, got: ${JSON.stringify(output)}`);
		engine.stop();
		terminal.stop();
	});

	it("renders row flexbox with children side by side", async () => {
		const { terminal, engine } = setupEngine(20, 5);
		const row = engine.createElement("ink-box", {
			flexDirection: "row",
			width: 10,
			height: 3,
		});
		const left = engine.createText("L", { color: "ansi:red" });
		const right = engine.createText("R", { color: "ansi:blue" });
		engine.appendChild(row, left);
		engine.appendChild(row, right);
		engine.appendChild(engine.rootNode, row);
		engine.start();
		await terminal.waitForRender();
		const viewport = terminal.getViewport();
		assert.strictEqual(charAt(viewport, 0, 0), "L", `should find L at (0,0), got: ${JSON.stringify(viewport[0])}`);
		assert.strictEqual(charAt(viewport, 1, 0), "R", `should find R at (1,0), got: ${JSON.stringify(viewport[0])}`);
		engine.stop();
		terminal.stop();
	});

	it("renders column flexbox with flexGrow distribution", async () => {
		const { terminal, engine } = setupEngine(20, 10);
		const col = engine.createElement("ink-box", {
			flexDirection: "column",
			width: 10,
			height: 10,
		});
		const growing = engine.createElement("ink-box", { flexGrow: 1 });
		const fixed = engine.createElement("ink-box", { height: 3, borderStyle: "single" });
		engine.appendChild(col, growing);
		engine.appendChild(col, fixed);
		engine.appendChild(engine.rootNode, col);
		engine.start();
		await terminal.waitForRender();
		assert.strictEqual(
			growing.yogaNode.getComputedHeight(),
			7,
			`growing should get height 7 (10-3), got: ${growing.yogaNode.getComputedHeight()}`,
		);
		assert.strictEqual(
			fixed.yogaNode.getComputedHeight(),
			3,
			`fixed should get height 3, got: ${fixed.yogaNode.getComputedHeight()}`,
		);
		const viewport = terminal.getViewport();
		assert.strictEqual(
			charAt(viewport, 0, 7),
			"\u250c",
			`should find ┌ at (0,7), got: ${JSON.stringify(viewport[7])}`,
		);
		engine.stop();
		terminal.stop();
	});
});
