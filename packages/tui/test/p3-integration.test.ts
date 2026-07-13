/**
 * P3 integration tests — Tasks 23 / 24 / 25 working together.
 *
 * Validates the end-to-end integration of:
 *   - Task 23: ScrollBox scroll container
 *   - Task 24: requestAnimationFrame-driven render loop
 *   - Task 25: DOM event dispatch (bubbling / stopPropagation / hit-test)
 *
 * Five scenarios:
 *   1. ScrollBox + Editor (wrapped via bridge) + animation-driven render:
 *      a keydown dispatched via `engine.handleInput` reaches the focused
 *      Editor's wrapped node, mutates editor content, and the mutation
 *      is reflected in the next render pass (scheduled via rAF).
 *   2. Event bubbling: a `click` dispatched on a text child reaches a
 *      `click` listener registered on the box ancestor.
 *   3. stopPropagation: when the target's listener calls
 *      `event.stopPropagation()`, the ancestor's listener does not fire.
 *   4. hitTest: `hitTest(root, x, y)` returns the deepest descendant
 *      whose border box contains `(x, y)`.
 *   5. Animation-frame coalescing: multiple `engine.requestRender()`
 *      calls within the same frame produce a single render pass
 *      (one batch of terminal writes).
 *
 * The CapturingVirtualTerminal pattern is reused from
 * {@link engine-render.test.ts} / {@link scroll-box.test.ts} so we can
 * assert on both the interpreted viewport (`getViewport`) and the raw
 * ANSI byte stream (`writes`).
 *
 * Test runner: Node built-in `node --test`.
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import { Editor } from "../src/components/editor.ts";
import { appendChild, createNode } from "../src/dom/tree.ts";
import { TuiEngine } from "../src/engine.ts";
import { dispatchEvent } from "../src/events/dispatcher.ts";
import { hitTest } from "../src/events/hit-test.ts";
import { type KeyboardEvent, SyntheticEvent } from "../src/events/synthetic-event.ts";
import { setKittyProtocolActive } from "../src/keys.ts";
import { TUI } from "../src/tui.ts";
import { defaultEditorTheme } from "./test-themes.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

// --
// Helpers

/**
 * VirtualTerminal subclass that captures every write for raw ANSI
 * inspection. The captured `writes` array lets render-coalescing tests
 * count how many render passes fired by counting write batches.
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
}

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

/** Create a legacy TUI backed by a virtual terminal, for Editor construction. */
function createLegacyTUI(cols = 80, rows = 24): { tui: TUI; terminal: VirtualTerminal } {
	const terminal = new VirtualTerminal(cols, rows);
	const tui = new TUI(terminal);
	return { tui, terminal };
}

// --
// Scenario 1: ScrollBox + wrapped Editor + animation-frame render

describe("p3-integration: ScrollBox + Editor + animation frame", () => {
	it("dispatches keydown to the focused Editor's wrapped node and renders the mutation", async () => {
		setKittyProtocolActive(false);
		const { terminal, engine } = setupEngine(30, 10);
		const legacy = createLegacyTUI(30, 10);
		const editor = new Editor(legacy.tui, defaultEditorTheme);
		try {
			editor.setText("initial");
			const editorNode = engine.wrapComponent(editor);
			const scrollBox = engine.createScrollBox({ height: 5 });
			engine.appendChild(scrollBox, editorNode);
			engine.appendChild(engine.rootNode, scrollBox);

			// Wire a keydown listener on the wrapped node — this is the
			// pattern a real TUI uses to forward key events to the legacy
			// component's handleInput. For this integration test we
			// simulate the effect of handleInput by appending printable
			// chars to the editor's text and requesting a render.
			let received: KeyboardEvent | undefined;
			editorNode.addEventListener("keydown", (event) => {
				const ke = event as KeyboardEvent;
				received = ke;
				if (ke.key.length === 1) {
					editor.setText(editor.getText() + ke.key);
					engine.requestRender();
				}
			});

			engine.start();
			await terminal.waitForRender();
			engine.focusNode(editorNode);
			await terminal.waitForRender();
			terminal.clearWrites();

			// Dispatch a keypress through the engine's input pipeline.
			// handleInput parses the data, constructs a KeyboardEvent, and
			// dispatches it to the focused element (editorNode).
			engine.handleInput("a");
			await terminal.waitForRender();

			// (1) Editor's wrapped node received the keydown event.
			assert.ok(received !== undefined, "keydown listener should have been called");
			assert.strictEqual(received!.key, "a", `key should be "a", got ${received!.key}`);
			assert.strictEqual(received!.target, editorNode, "target should be the editor's wrapped node");

			// (2) The listener mutated editor text and called requestRender;
			// the renderLoop (scheduled via rAF) should have produced writes.
			assert.ok(terminal.writes.length > 0, "renderLoop should have produced writes via rAF");

			// (3) The viewport now reflects the updated editor text. The
			// Editor renders with a top border, content line(s), and bottom
			// border; the appended "a" should be visible somewhere in the
			// viewport.
			const viewport = terminal.getViewport();
			const output = viewport.join("\n");
			assert.ok(
				output.includes("initiala"),
				`viewport should contain updated editor text "initiala", got: ${JSON.stringify(viewport.slice(0, 6))}`,
			);

			engine.stop();
		} finally {
			legacy.terminal.stop();
			terminal.stop();
		}
	});
});

// --
// Scenario 2: event bubbling (click on child reaches ancestor listener)

describe("p3-integration: event bubbling", () => {
	it("bubbles a click event from a text child to a box ancestor", () => {
		const root = createNode("ink-box", { width: 10, height: 10 });
		const box = createNode("ink-box", { width: 8, height: 8 });
		const text = createNode("ink-text", { width: 3, height: 1 });
		appendChild(root, box);
		appendChild(box, text);
		root.yogaNode.calculateLayout(10, 10);

		let boxCalled = 0;
		let textCalled = 0;
		box.addEventListener("click", () => {
			boxCalled++;
		});
		text.addEventListener("click", () => {
			textCalled++;
		});

		const event = new SyntheticEvent("click", text);
		const notPrevented = dispatchEvent(text, event);

		assert.strictEqual(textCalled, 1, "text listener should fire on its own event");
		assert.strictEqual(boxCalled, 1, "box listener should fire via bubbling");
		assert.strictEqual(notPrevented, true, "default should not be prevented");
	});
});

// --
// Scenario 3: stopPropagation halts bubbling

describe("p3-integration: stopPropagation", () => {
	it("prevents the ancestor listener from firing when the target stops propagation", () => {
		const root = createNode("ink-box", { width: 10, height: 10 });
		const box = createNode("ink-box", { width: 8, height: 8 });
		const text = createNode("ink-text", { width: 3, height: 1 });
		appendChild(root, box);
		appendChild(box, text);
		root.yogaNode.calculateLayout(10, 10);

		let boxCalled = 0;
		let textCalled = 0;
		box.addEventListener("click", () => {
			boxCalled++;
		});
		text.addEventListener("click", (event) => {
			textCalled++;
			event.stopPropagation();
		});

		dispatchEvent(text, new SyntheticEvent("click", text));

		assert.strictEqual(textCalled, 1, "text listener should still fire on the target");
		assert.strictEqual(boxCalled, 0, "box listener should NOT fire after stopPropagation");
	});
});

// --
// Scenario 4: hitTest finds the deepest node at (x, y)

describe("p3-integration: hitTest", () => {
	it("returns the deepest node whose border box contains (x, y)", () => {
		const root = createNode("ink-box", { width: 20, height: 20 });
		const outer = createNode("ink-box", { width: 10, height: 10 });
		const inner = createNode("ink-box", { width: 4, height: 4 });
		appendChild(root, outer);
		appendChild(outer, inner);
		root.yogaNode.calculateLayout(20, 20);

		// (1, 1) is inside inner (which sits at 0,0 with 4x4 size).
		const hitInner = hitTest(root, 1, 1);
		assert.strictEqual(hitInner, inner, "should hit inner at (1,1)");

		// (8, 8) is inside outer but outside inner.
		const hitOuter = hitTest(root, 8, 8);
		assert.strictEqual(hitOuter, outer, "should hit outer at (8,8)");

		// (15, 15) is inside root but outside outer.
		const hitRoot = hitTest(root, 15, 15);
		assert.strictEqual(hitRoot, root, "should hit root at (15,15)");

		// (25, 25) is outside root entirely.
		const hitOutside = hitTest(root, 25, 25);
		assert.strictEqual(hitOutside, null, "should return null for points outside root");
	});
});

// --
// Scenario 5: animation-frame coalescing (multiple requestRender → one pass)

describe("p3-integration: animation-frame coalescing", () => {
	it("coalesces multiple requestRender calls into a single render pass", async () => {
		const { terminal, engine } = setupEngine(20, 5);
		const text = engine.createText("hello");
		engine.appendChild(engine.rootNode, text);
		engine.start();
		await terminal.waitForRender();

		// Measure writes for a single requestRender.
		terminal.clearWrites();
		text.textContent = "v1";
		engine.requestRender();
		await terminal.waitForRender();
		const singleRenderWrites = terminal.writes.length;
		assert.ok(singleRenderWrites > 0, "single requestRender should produce writes");

		// Triple requestRender in the same frame should produce the same
		// number of writes (one render pass), not three.
		terminal.clearWrites();
		text.textContent = "v2";
		engine.requestRender();
		engine.requestRender();
		engine.requestRender();
		await terminal.waitForRender();
		const tripleRenderWrites = terminal.writes.length;

		assert.strictEqual(
			tripleRenderWrites,
			singleRenderWrites,
			`triple requestRender should coalesce to one render pass (got ${tripleRenderWrites} vs ${singleRenderWrites} writes)`,
		);

		// The viewport should reflect only the latest mutation, confirming
		// a single render pass captured the final state.
		const viewport = terminal.getViewport();
		const output = viewport.join("\n");
		assert.ok(output.includes("v2"), `viewport should contain "v2", got: ${JSON.stringify(viewport.slice(0, 2))}`);
		assert.ok(
			!output.includes("v1"),
			`viewport should NOT contain "v1", got: ${JSON.stringify(viewport.slice(0, 2))}`,
		);

		engine.stop();
		terminal.stop();
	});

	it("schedules a fresh render pass on the next frame after a render completes", async () => {
		// Guards against the coalescing flag getting stuck: after a render
		// completes (renderScheduled=false), a new requestRender should
		// schedule a fresh rAF and produce writes.
		const { terminal, engine } = setupEngine(20, 5);
		const text = engine.createText("a");
		engine.appendChild(engine.rootNode, text);
		engine.start();
		await terminal.waitForRender();

		// First render after start.
		terminal.clearWrites();
		text.textContent = "b";
		engine.requestRender();
		await terminal.waitForRender();
		const firstPass = terminal.writes.length;
		assert.ok(firstPass > 0, "first requestRender should produce writes");

		// Second render in a new frame — should also produce writes.
		terminal.clearWrites();
		text.textContent = "c";
		engine.requestRender();
		await terminal.waitForRender();
		const secondPass = terminal.writes.length;
		assert.ok(secondPass > 0, "second requestRender in a new frame should produce writes");

		engine.stop();
		terminal.stop();
	});
});
