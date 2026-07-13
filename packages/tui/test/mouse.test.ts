/**
 * Task 27 tests — mouse event support.
 *
 * Validates SGR-1006 mouse sequence parsing, terminal mouse mode
 * enable/disable output, and hit-test + dispatch integration in
 * TuiEngine.handleInput (including click synthesis).
 *
 * Test runner: Node built-in `node --test`.
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import { TuiEngine } from "../src/engine.ts";
import { parseMouseSequence } from "../src/events/parse-mouse.ts";
import { MouseEvent } from "../src/events/synthetic-event.ts";
import { setKittyProtocolActive } from "../src/keys.ts";
import { ProcessTerminal } from "../src/terminal.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

// --
// parseMouseSequence

describe("parseMouseSequence", () => {
	it("parses left button press", () => {
		// SGR-1006 format: ESC[<button;col;rowM (no semicolon before M)
		const event = parseMouseSequence("\x1b[<0;10;5M");
		assert.ok(event !== null);
		assert.strictEqual(event!.type, "mousedown");
		assert.strictEqual(event!.button, 0);
		assert.strictEqual(event!.col, 9);
		assert.strictEqual(event!.row, 4);
		assert.strictEqual(event!.shiftKey, false);
		assert.strictEqual(event!.altKey, false);
		assert.strictEqual(event!.ctrlKey, false);
	});

	it("parses right button press", () => {
		const event = parseMouseSequence("\x1b[<2;10;5M");
		assert.ok(event !== null);
		assert.strictEqual(event!.type, "mousedown");
		assert.strictEqual(event!.button, 2);
	});

	it("parses middle button press", () => {
		const event = parseMouseSequence("\x1b[<1;10;5M");
		assert.ok(event !== null);
		assert.strictEqual(event!.type, "mousedown");
		assert.strictEqual(event!.button, 1);
	});

	it("parses release as mouseup", () => {
		const event = parseMouseSequence("\x1b[<0;10;5m");
		assert.ok(event !== null);
		assert.strictEqual(event!.type, "mouseup");
		assert.strictEqual(event!.button, 0);
	});

	it("parses shift modifier", () => {
		const event = parseMouseSequence("\x1b[<4;10;5M");
		assert.ok(event !== null);
		assert.strictEqual(event!.shiftKey, true);
		assert.strictEqual(event!.altKey, false);
		assert.strictEqual(event!.ctrlKey, false);
		assert.strictEqual(event!.button, 0);
	});

	it("parses alt modifier", () => {
		const event = parseMouseSequence("\x1b[<8;10;5M");
		assert.ok(event !== null);
		assert.strictEqual(event!.altKey, true);
		assert.strictEqual(event!.shiftKey, false);
		assert.strictEqual(event!.ctrlKey, false);
		assert.strictEqual(event!.button, 0);
	});

	it("parses ctrl modifier", () => {
		const event = parseMouseSequence("\x1b[<16;10;5M");
		assert.ok(event !== null);
		assert.strictEqual(event!.ctrlKey, true);
		assert.strictEqual(event!.shiftKey, false);
		assert.strictEqual(event!.altKey, false);
		assert.strictEqual(event!.button, 0);
	});

	it("parses combined modifiers (shift+alt+ctrl)", () => {
		// 4 + 8 + 16 = 28
		const event = parseMouseSequence("\x1b[<28;10;5M");
		assert.ok(event !== null);
		assert.strictEqual(event!.shiftKey, true);
		assert.strictEqual(event!.altKey, true);
		assert.strictEqual(event!.ctrlKey, true);
	});

	it("parses wheel up as mousewheel with deltaY -1", () => {
		const event = parseMouseSequence("\x1b[<64;10;5M");
		assert.ok(event !== null);
		assert.strictEqual(event!.type, "mousewheel");
		assert.strictEqual(event!.deltaY, -1);
	});

	it("parses wheel down as mousewheel with deltaY 1", () => {
		const event = parseMouseSequence("\x1b[<65;10;5M");
		assert.ok(event !== null);
		assert.strictEqual(event!.type, "mousewheel");
		assert.strictEqual(event!.deltaY, 1);
	});

	it("parses motion (drag) as mousemove", () => {
		// 32 = motion flag + 0 = left button held
		const event = parseMouseSequence("\x1b[<32;10;5M");
		assert.ok(event !== null);
		assert.strictEqual(event!.type, "mousemove");
		assert.strictEqual(event!.button, 0);
	});

	it("converts 1-based coordinates to 0-based", () => {
		const event = parseMouseSequence("\x1b[<0;1;1M");
		assert.ok(event !== null);
		assert.strictEqual(event!.col, 0);
		assert.strictEqual(event!.row, 0);
	});

	it("returns null for non-mouse input", () => {
		assert.strictEqual(parseMouseSequence("a"), null);
		assert.strictEqual(parseMouseSequence("\x1b[A"), null);
		assert.strictEqual(parseMouseSequence(""), null);
	});

	it("returns null for malformed SGR sequence", () => {
		// Malformed: non-digit button field.
		assert.strictEqual(parseMouseSequence("\x1b[<abc;1;2M"), null);
		// Malformed: wrong terminating byte.
		assert.strictEqual(parseMouseSequence("\x1b[<0;1;2X"), null);
	});

	it("returns MouseEvent with null target", () => {
		const event = parseMouseSequence("\x1b[<0;10;5M");
		assert.ok(event !== null);
		assert.strictEqual(event!.target, null);
		assert.ok(event instanceof MouseEvent);
	});
});

// --
// ProcessTerminal enableMouseMode / disableMouseMode

describe("ProcessTerminal mouse mode", () => {
	type MouseHarness = {
		terminal: ProcessTerminal;
		writes: string[];
		cleanup(): void;
	};

	function setupMouse(): MouseHarness {
		const terminal = new ProcessTerminal();
		const writes: string[] = [];
		const previousWrite = process.stdout.write;

		process.stdout.write = ((chunk: string | Uint8Array) => {
			writes.push(String(chunk));
			return true;
		}) as typeof process.stdout.write;

		return {
			terminal,
			writes,
			cleanup(): void {
				process.stdout.write = previousWrite;
			},
		};
	}

	it("enableMouseMode writes SGR enable sequences", () => {
		const harness = setupMouse();
		try {
			harness.terminal.enableMouseMode();
			assert.strictEqual(harness.writes.join(""), "\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h");
			assert.strictEqual(harness.terminal.isMouseModeEnabled(), true);
		} finally {
			harness.cleanup();
		}
	});

	it("disableMouseMode writes SGR disable sequences", () => {
		const harness = setupMouse();
		try {
			harness.terminal.enableMouseMode();
			harness.writes.length = 0;
			harness.terminal.disableMouseMode();
			assert.strictEqual(harness.writes.join(""), "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l");
			assert.strictEqual(harness.terminal.isMouseModeEnabled(), false);
		} finally {
			harness.cleanup();
		}
	});

	it("isMouseModeEnabled reflects current state", () => {
		const harness = setupMouse();
		try {
			assert.strictEqual(harness.terminal.isMouseModeEnabled(), false);
			harness.terminal.enableMouseMode();
			assert.strictEqual(harness.terminal.isMouseModeEnabled(), true);
			harness.terminal.disableMouseMode();
			assert.strictEqual(harness.terminal.isMouseModeEnabled(), false);
		} finally {
			harness.cleanup();
		}
	});
});

// --
// TuiEngine.handleInput mouse dispatch

describe("TuiEngine.handleInput: mouse dispatch", () => {
	it("dispatches mousedown to the hit-tested target", () => {
		setKittyProtocolActive(false);
		const terminal = new VirtualTerminal(20, 10);
		terminal.start(
			() => undefined,
			() => undefined,
		);
		const engine = new TuiEngine(terminal);

		const target = engine.createElement("ink-box", { width: 10, height: 5 });
		engine.appendChild(engine.rootNode, target);
		engine.rootNode.yogaNode.calculateLayout(20, 10);

		let received: MouseEvent | undefined;
		target.addEventListener("mousedown", (e) => {
			received = e as MouseEvent;
		});

		// col=3 (1-based 4), row=2 (1-based 3) → inside target
		engine.handleInput("\x1b[<0;4;3M");

		assert.ok(received !== undefined, "mousedown listener should have been called");
		assert.strictEqual(received!.type, "mousedown");
		assert.strictEqual(received!.button, 0);
		assert.strictEqual(received!.col, 3);
		assert.strictEqual(received!.row, 2);
		assert.strictEqual(received!.target, target);

		engine.stop();
		terminal.stop();
	});

	it("dispatches mouseup after mousedown", () => {
		setKittyProtocolActive(false);
		const terminal = new VirtualTerminal(20, 10);
		terminal.start(
			() => undefined,
			() => undefined,
		);
		const engine = new TuiEngine(terminal);

		const target = engine.createElement("ink-box", { width: 10, height: 5 });
		engine.appendChild(engine.rootNode, target);
		engine.rootNode.yogaNode.calculateLayout(20, 10);

		let upReceived = false;
		target.addEventListener("mouseup", () => {
			upReceived = true;
		});

		engine.handleInput("\x1b[<0;4;3M");
		engine.handleInput("\x1b[<0;4;3m");

		assert.strictEqual(upReceived, true);

		engine.stop();
		terminal.stop();
	});

	it("synthesizes click after mousedown+mouseup on same target", () => {
		setKittyProtocolActive(false);
		const terminal = new VirtualTerminal(20, 10);
		terminal.start(
			() => undefined,
			() => undefined,
		);
		const engine = new TuiEngine(terminal);

		const target = engine.createElement("ink-box", { width: 10, height: 5 });
		engine.appendChild(engine.rootNode, target);
		engine.rootNode.yogaNode.calculateLayout(20, 10);

		let clickCount = 0;
		let clickEvent: MouseEvent | undefined;
		target.addEventListener("click", (e) => {
			clickCount++;
			clickEvent = e as MouseEvent;
		});

		engine.handleInput("\x1b[<0;4;3M");
		engine.handleInput("\x1b[<0;4;3m");

		assert.strictEqual(clickCount, 1);
		assert.ok(clickEvent !== undefined);
		assert.strictEqual(clickEvent!.type, "click");
		assert.strictEqual(clickEvent!.target, target);

		engine.stop();
		terminal.stop();
	});

	it("does not synthesize click when target differs", () => {
		setKittyProtocolActive(false);
		const terminal = new VirtualTerminal(20, 10);
		terminal.start(
			() => undefined,
			() => undefined,
		);
		const engine = new TuiEngine(terminal);

		const targetA = engine.createElement("ink-box", { width: 5, height: 5 });
		const targetB = engine.createElement("ink-box", { width: 5, height: 5 });
		engine.appendChild(engine.rootNode, targetA);
		engine.appendChild(engine.rootNode, targetB);
		engine.rootNode.yogaNode.calculateLayout(20, 10);

		let clickCount = 0;
		targetA.addEventListener("click", () => clickCount++);
		targetB.addEventListener("click", () => clickCount++);

		// mousedown on A (col=2, row=1)
		engine.handleInput("\x1b[<0;3;2M");
		// mouseup on B (col=8, row=1)
		engine.handleInput("\x1b[<0;9;2m");

		assert.strictEqual(clickCount, 0);

		engine.stop();
		terminal.stop();
	});

	it("dispatches mousewheel events", () => {
		setKittyProtocolActive(false);
		const terminal = new VirtualTerminal(20, 10);
		terminal.start(
			() => undefined,
			() => undefined,
		);
		const engine = new TuiEngine(terminal);

		const target = engine.createElement("ink-box", { width: 10, height: 5 });
		engine.appendChild(engine.rootNode, target);
		engine.rootNode.yogaNode.calculateLayout(20, 10);

		let received: MouseEvent | undefined;
		target.addEventListener("mousewheel", (e) => {
			received = e as MouseEvent;
		});

		engine.handleInput("\x1b[<64;4;3M");

		assert.ok(received !== undefined);
		assert.strictEqual(received!.type, "mousewheel");
		assert.strictEqual(received!.deltaY, -1);

		engine.stop();
		terminal.stop();
	});

	it("dispatches to rootNode when point is outside all children", () => {
		setKittyProtocolActive(false);
		const terminal = new VirtualTerminal(20, 10);
		terminal.start(
			() => undefined,
			() => undefined,
		);
		const engine = new TuiEngine(terminal);

		const child = engine.createElement("ink-box", { width: 5, height: 5 });
		engine.appendChild(engine.rootNode, child);
		engine.rootNode.yogaNode.calculateLayout(20, 10);

		let received = false;
		engine.rootNode.addEventListener("mousedown", () => {
			received = true;
		});

		// col=15 (outside child), row=8
		engine.handleInput("\x1b[<0;16;9M");

		assert.strictEqual(received, true);

		engine.stop();
		terminal.stop();
	});

	it("passes modifier flags through to the event", () => {
		setKittyProtocolActive(false);
		const terminal = new VirtualTerminal(20, 10);
		terminal.start(
			() => undefined,
			() => undefined,
		);
		const engine = new TuiEngine(terminal);

		const target = engine.createElement("ink-box", { width: 10, height: 5 });
		engine.appendChild(engine.rootNode, target);
		engine.rootNode.yogaNode.calculateLayout(20, 10);

		let received: MouseEvent | undefined;
		target.addEventListener("mousedown", (e) => {
			received = e as MouseEvent;
		});

		// shift+alt+ctrl+left = 4+8+16 = 28
		engine.handleInput("\x1b[<28;4;3M");

		assert.ok(received !== undefined);
		assert.strictEqual(received!.shiftKey, true);
		assert.strictEqual(received!.altKey, true);
		assert.strictEqual(received!.ctrlKey, true);

		engine.stop();
		terminal.stop();
	});

	it("does not interfere with keyboard input", () => {
		setKittyProtocolActive(false);
		const terminal = new VirtualTerminal(20, 10);
		terminal.start(
			() => undefined,
			() => undefined,
		);
		const engine = new TuiEngine(terminal);

		const target = engine.createElement("ink-box", { width: 10, height: 5 });
		engine.appendChild(engine.rootNode, target);
		engine.focusNode(target);
		engine.rootNode.yogaNode.calculateLayout(20, 10);

		let keyReceived = false;
		target.addEventListener("keydown", () => {
			keyReceived = true;
		});

		engine.handleInput("a");

		assert.strictEqual(keyReceived, true);

		engine.stop();
		terminal.stop();
	});

	it("enables mouse mode on start and disables on stop", () => {
		setKittyProtocolActive(false);
		const terminal = new VirtualTerminal(20, 10);
		let enableCalled = false;
		let disableCalled = false;
		const origEnable = terminal.enableMouseMode.bind(terminal);
		const origDisable = terminal.disableMouseMode.bind(terminal);
		terminal.enableMouseMode = () => {
			enableCalled = true;
			origEnable();
		};
		terminal.disableMouseMode = () => {
			disableCalled = true;
			origDisable();
		};

		terminal.start(
			() => undefined,
			() => undefined,
		);
		const engine = new TuiEngine(terminal);

		engine.start();
		assert.strictEqual(enableCalled, true);

		engine.stop();
		assert.strictEqual(disableCalled, true);

		terminal.stop();
	});
});

// --
// hit-test + dispatch integration

describe("hit-test + dispatch: overlay preference", () => {
	it("prefers later-appended overlay for mouse events", () => {
		setKittyProtocolActive(false);
		const terminal = new VirtualTerminal(20, 10);
		terminal.start(
			() => undefined,
			() => undefined,
		);
		const engine = new TuiEngine(terminal);

		const normal = engine.createElement("ink-box", { width: 5, height: 5 });
		const overlay = engine.createElement("ink-box", {
			position: "absolute",
			top: 0,
			left: 0,
			width: 5,
			height: 5,
		});
		engine.appendChild(engine.rootNode, normal);
		engine.appendChild(engine.rootNode, overlay);
		engine.rootNode.yogaNode.calculateLayout(20, 10);

		let normalCalled = false;
		let overlayCalled = false;
		normal.addEventListener("mousedown", () => {
			normalCalled = true;
		});
		overlay.addEventListener("mousedown", () => {
			overlayCalled = true;
		});

		engine.handleInput("\x1b[<0;3;3M");

		assert.strictEqual(overlayCalled, true);
		assert.strictEqual(normalCalled, false);

		engine.stop();
		terminal.stop();
	});
});
