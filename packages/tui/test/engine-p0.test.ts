import assert from "node:assert";
import { describe, it } from "node:test";
import { TuiEngine } from "../src/engine.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

// --
// P0 integration tests — final validation of the Yoga-backed TuiEngine.
//
// These tests exercise the three pillars of the P0 engine:
//   1. Yoga layout calculation (flex grow / fixed height in a column)
//   2. Text rendering to the terminal ("Hello Yoga")
//   3. Differential rendering (textContent update via requestRender)
//
// The terminal lifecycle (start/stop) is owned by the test, matching the
// TuiEngine contract: the engine does not start or stop the terminal.

// --
// Test 1: Yoga layout calculation

describe("P0 integration: Yoga layout calculation", () => {
	it("computes flex heights for column children (flexGrow + fixed height)", async () => {
		const terminal = new VirtualTerminal(80, 24);
		terminal.start(
			() => undefined,
			() => undefined,
		);

		const engine = new TuiEngine(terminal);

		// Column flexbox container filling the terminal.
		const box = engine.createElement("ink-box", {
			flexDirection: "column",
			width: "100%",
			height: "100%",
		});

		// Child 1: flexGrow = 1 — should absorb remaining vertical space.
		const growing = engine.createElement("ink-box", { flexGrow: 1 });

		// Child 2: fixed height = 5.
		const fixed = engine.createElement("ink-box", { height: 5 });

		engine.appendChild(box, growing);
		engine.appendChild(box, fixed);
		engine.appendChild(engine.rootNode, box);

		engine.start();
		await terminal.waitForRender();

		const terminalHeight = 24;
		const expectedGrowingHeight = terminalHeight - 5;

		const growingHeight = growing.yogaNode.getComputedHeight();
		assert.strictEqual(
			growingHeight,
			expectedGrowingHeight,
			`growing child height should be ${expectedGrowingHeight} (terminalHeight - 5), got ${growingHeight}`,
		);

		const fixedHeight = fixed.yogaNode.getComputedHeight();
		assert.strictEqual(fixedHeight, 5, `fixed child height should be 5, got ${fixedHeight}`);

		engine.stop();
		terminal.stop();
	});
});

// --
// Test 2: "Hello Yoga" text display

describe("P0 integration: Hello Yoga text display", () => {
	it("renders ink-text content to the terminal", async () => {
		const terminal = new VirtualTerminal(80, 24);
		terminal.start(
			() => undefined,
			() => undefined,
		);

		const engine = new TuiEngine(terminal);

		const text = engine.createText("Hello Yoga!");
		engine.appendChild(engine.rootNode, text);

		engine.start();
		await terminal.waitForRender();

		const viewport = terminal.getViewport();
		const output = viewport.join("\n");
		assert.ok(
			output.includes("Hello Yoga"),
			`Expected terminal to contain "Hello Yoga", got: ${JSON.stringify(viewport.slice(0, 3))}`,
		);

		engine.stop();
		terminal.stop();
	});
});

// --
// Test 3: diff rendering (textContent update via requestRender)

describe("P0 integration: diff rendering", () => {
	it("updates terminal content when textContent changes and requestRender is called", async () => {
		const terminal = new VirtualTerminal(80, 24);
		terminal.start(
			() => undefined,
			() => undefined,
		);

		const engine = new TuiEngine(terminal);

		// First frame: "Hello"
		const text = engine.createText("Hello");
		engine.appendChild(engine.rootNode, text);

		engine.start();
		await terminal.waitForRender();

		// Second frame: change textContent and request a re-render.
		text.textContent = "Hello Yoga!";
		engine.requestRender();
		await terminal.waitForRender();

		const viewport = terminal.getViewport();
		const output = viewport.join("\n");
		assert.ok(
			output.includes("Hello Yoga!"),
			`Expected terminal to contain "Hello Yoga!" after diff render, got: ${JSON.stringify(viewport.slice(0, 3))}`,
		);

		engine.stop();
		terminal.stop();
	});
});
