/**
 * Task 25 tests — DOM-style event dispatch.
 *
 * Validates synthetic events, the dispatcher (bubbling / stopPropagation /
 * preventDefault), hit-testing (including position: absolute overlay
 * preference), TuiElement listener registration, and TuiEngine.handleInput
 * constructing KeyboardEvent instances and dispatching them to the active
 * element.
 *
 * Test runner: Node built-in `node --test`.
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import { appendChild, createNode, type TuiElement } from "../src/dom/tree.ts";
import { TuiEngine } from "../src/engine.ts";
import { dispatchEvent } from "../src/events/dispatcher.ts";
import { hitTest } from "../src/events/hit-test.ts";
import { KeyboardEvent, SyntheticEvent } from "../src/events/synthetic-event.ts";
import { setKittyProtocolActive } from "../src/keys.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

// --
// Helpers

function makeBubbleChain(): { root: TuiElement; parent: TuiElement; child: TuiElement } {
	const root = createNode("ink-box");
	const parent = createNode("ink-box");
	const child = createNode("ink-box");
	appendChild(parent, child);
	appendChild(root, parent);
	return { root, parent, child };
}

// --
// SyntheticEvent basics

describe("synthetic-event: basics", () => {
	it("stopPropagation marks propagation as stopped", () => {
		const node = createNode("ink-box");
		const event = new SyntheticEvent("click", node);
		assert.strictEqual(event.isPropagationStopped(), false);
		event.stopPropagation();
		assert.strictEqual(event.isPropagationStopped(), true);
	});

	it("preventDefault sets defaultPrevented on cancelable events", () => {
		const node = createNode("ink-box");
		const event = new SyntheticEvent("click", node, { cancelable: true });
		assert.strictEqual(event.defaultPrevented, false);
		event.preventDefault();
		assert.strictEqual(event.defaultPrevented, true);
	});

	it("preventDefault is a no-op on non-cancelable events", () => {
		const node = createNode("ink-box");
		const event = new SyntheticEvent("click", node, { cancelable: false });
		event.preventDefault();
		assert.strictEqual(event.defaultPrevented, false);
	});

	it("bubbles defaults to true", () => {
		const node = createNode("ink-box");
		const event = new SyntheticEvent("click", node);
		assert.strictEqual(event.bubbles, true);
	});

	it("cancelable defaults to true", () => {
		const node = createNode("ink-box");
		const event = new SyntheticEvent("click", node);
		assert.strictEqual(event.cancelable, true);
	});

	it("target and currentTarget are set on construction", () => {
		const node = createNode("ink-box");
		const event = new SyntheticEvent("click", node);
		assert.strictEqual(event.target, node);
		assert.strictEqual(event.currentTarget, node);
	});

	it("timestamp is a non-negative number", () => {
		const node = createNode("ink-box");
		const event = new SyntheticEvent("click", node);
		assert.ok(typeof event.timestamp === "number" && event.timestamp >= 0);
	});

	it("type is stored from constructor", () => {
		const node = createNode("ink-box");
		const event = new SyntheticEvent("keydown", node);
		assert.strictEqual(event.type, "keydown");
	});
});

// --
// dispatchEvent bubbling

describe("dispatchEvent: bubbling", () => {
	it("bubbles from target through ancestors to root", () => {
		const { root, parent, child } = makeBubbleChain();
		const path: string[] = [];
		root.addEventListener("click", () => path.push("root"));
		parent.addEventListener("click", () => path.push("parent"));
		child.addEventListener("click", () => path.push("child"));

		const event = new SyntheticEvent("click", child);
		const result = dispatchEvent(child, event);

		assert.deepStrictEqual(path, ["child", "parent", "root"]);
		assert.strictEqual(result, true);
	});

	it("sets currentTarget to each bubbling node", () => {
		const { root, child } = makeBubbleChain();
		const seen: TuiElement[] = [];
		child.addEventListener("click", (e) => seen.push(e.currentTarget!));
		root.addEventListener("click", (e) => seen.push(e.currentTarget!));

		dispatchEvent(child, new SyntheticEvent("click", child));
		assert.deepStrictEqual(seen, [child, root]);
	});

	it("target stays as original target throughout bubbling", () => {
		const { root, child } = makeBubbleChain();
		let seenTarget: TuiElement | null | undefined;
		root.addEventListener("click", (e) => {
			seenTarget = e.target;
		});

		dispatchEvent(child, new SyntheticEvent("click", child));
		assert.strictEqual(seenTarget, child);
	});

	it("only fires listeners matching the event type", () => {
		const node = createNode("ink-box");
		let clicked = false;
		let keyed = false;
		node.addEventListener("click", () => {
			clicked = true;
		});
		node.addEventListener("keydown", () => {
			keyed = true;
		});

		dispatchEvent(node, new SyntheticEvent("keydown", node));
		assert.strictEqual(clicked, false);
		assert.strictEqual(keyed, true);
	});
});

// --
// dispatchEvent stopPropagation

describe("dispatchEvent: stopPropagation", () => {
	it("stops bubbling when stopPropagation is called", () => {
		const { root, parent, child } = makeBubbleChain();
		const path: string[] = [];
		child.addEventListener("click", () => path.push("child"));
		parent.addEventListener("click", (e) => {
			path.push("parent");
			e.stopPropagation();
		});
		root.addEventListener("click", () => path.push("root"));

		dispatchEvent(child, new SyntheticEvent("click", child));
		assert.deepStrictEqual(path, ["child", "parent"]);
	});

	it("stopPropagation at target prevents all bubbling", () => {
		const { root, parent, child } = makeBubbleChain();
		const path: string[] = [];
		child.addEventListener("click", (e) => {
			path.push("child");
			e.stopPropagation();
		});
		parent.addEventListener("click", () => path.push("parent"));
		root.addEventListener("click", () => path.push("root"));

		dispatchEvent(child, new SyntheticEvent("click", child));
		assert.deepStrictEqual(path, ["child"]);
	});
});

// --
// dispatchEvent preventDefault / return value

describe("dispatchEvent: preventDefault", () => {
	it("returns false when default is prevented", () => {
		const node = createNode("ink-box");
		node.addEventListener("click", (e) => e.preventDefault());

		const event = new SyntheticEvent("click", node, { cancelable: true });
		assert.strictEqual(dispatchEvent(node, event), false);
	});

	it("returns true when default is not prevented", () => {
		const node = createNode("ink-box");
		node.addEventListener("click", () => {});

		const event = new SyntheticEvent("click", node, { cancelable: true });
		assert.strictEqual(dispatchEvent(node, event), true);
	});

	it("preventDefault on non-cancelable event does not affect return value", () => {
		const node = createNode("ink-box");
		node.addEventListener("click", (e) => e.preventDefault());

		const event = new SyntheticEvent("click", node, { cancelable: false });
		assert.strictEqual(dispatchEvent(node, event), true);
	});
});

// --
// TuiElement addEventListener / removeEventListener

describe("TuiElement: addEventListener / removeEventListener", () => {
	it("addEventListener registers a listener that fires on dispatch", () => {
		const node = createNode("ink-box");
		let called = false;
		node.addEventListener("click", () => {
			called = true;
		});

		dispatchEvent(node, new SyntheticEvent("click", node));
		assert.strictEqual(called, true);
	});

	it("removeEventListener unregisters the listener", () => {
		const node = createNode("ink-box");
		let called = false;
		const listener = (): void => {
			called = true;
		};
		node.addEventListener("click", listener);
		node.removeEventListener("click", listener);

		dispatchEvent(node, new SyntheticEvent("click", node));
		assert.strictEqual(called, false);
	});

	it("multiple listeners of the same type all fire", () => {
		const node = createNode("ink-box");
		let count = 0;
		node.addEventListener("click", () => count++);
		node.addEventListener("click", () => count++);

		dispatchEvent(node, new SyntheticEvent("click", node));
		assert.strictEqual(count, 2);
	});

	it("listeners defaults to empty Map on new nodes", () => {
		const node = createNode("ink-box");
		assert.ok(node.listeners instanceof Map);
		assert.strictEqual(node.listeners.size, 0);
	});
});

// --
// hitTest

describe("hitTest", () => {
	it("returns the child node containing the point", () => {
		const root = createNode("ink-box", { width: 10, height: 10 });
		const child = createNode("ink-box", { width: 5, height: 5 });
		appendChild(root, child);
		root.yogaNode.calculateLayout(10, 10);

		const hit = hitTest(root, 2, 2);
		assert.strictEqual(hit, child);
	});

	it("returns root when point is in root but not in any child", () => {
		const root = createNode("ink-box", { width: 10, height: 10 });
		const child = createNode("ink-box", { width: 5, height: 5 });
		appendChild(root, child);
		root.yogaNode.calculateLayout(10, 10);

		const hit = hitTest(root, 7, 7);
		assert.strictEqual(hit, root);
	});

	it("returns null when point is outside root", () => {
		const root = createNode("ink-box", { width: 10, height: 10 });
		root.yogaNode.calculateLayout(10, 10);

		const hit = hitTest(root, 20, 20);
		assert.strictEqual(hit, null);
	});

	it("returns the deepest node containing the point", () => {
		const root = createNode("ink-box", { width: 10, height: 10 });
		const outer = createNode("ink-box", { width: 8, height: 8 });
		const inner = createNode("ink-box", { width: 3, height: 3 });
		appendChild(root, outer);
		appendChild(outer, inner);
		root.yogaNode.calculateLayout(10, 10);

		const hit = hitTest(root, 1, 1);
		assert.strictEqual(hit, inner);
	});

	it("prefers later-appended position: absolute overlay over normal child", () => {
		const root = createNode("ink-box", { width: 10, height: 10 });
		const normal = createNode("ink-box", { width: 5, height: 5 });
		const overlay = createNode("ink-box", {
			position: "absolute",
			top: 0,
			left: 0,
			width: 5,
			height: 5,
		});
		appendChild(root, normal);
		appendChild(root, overlay);
		root.yogaNode.calculateLayout(10, 10);

		const hit = hitTest(root, 2, 2);
		assert.strictEqual(hit, overlay);
	});

	it("returns normal child when overlay does not cover the point", () => {
		const root = createNode("ink-box", { width: 10, height: 10 });
		const normal = createNode("ink-box", { width: 5, height: 5 });
		const overlay = createNode("ink-box", {
			position: "absolute",
			top: 5,
			left: 5,
			width: 3,
			height: 3,
		});
		appendChild(root, normal);
		appendChild(root, overlay);
		root.yogaNode.calculateLayout(10, 10);

		const hit = hitTest(root, 2, 2);
		assert.strictEqual(hit, normal);
	});
});

// --
// KeyboardEvent

describe("KeyboardEvent", () => {
	it("carries key and modifier fields", () => {
		const node = createNode("ink-box");
		const event = new KeyboardEvent(node, {
			key: "c",
			ctrlKey: true,
			altKey: false,
			shiftKey: true,
			metaKey: false,
		});
		assert.strictEqual(event.type, "keydown");
		assert.strictEqual(event.key, "c");
		assert.strictEqual(event.code, "c");
		assert.strictEqual(event.ctrlKey, true);
		assert.strictEqual(event.altKey, false);
		assert.strictEqual(event.shiftKey, true);
		assert.strictEqual(event.metaKey, false);
	});

	it("is an instance of SyntheticEvent", () => {
		const node = createNode("ink-box");
		const event = new KeyboardEvent(node, { key: "a" });
		assert.ok(event instanceof SyntheticEvent);
		assert.ok(event instanceof KeyboardEvent);
	});

	it("defaults code to key when not specified", () => {
		const node = createNode("ink-box");
		const event = new KeyboardEvent(node, { key: "enter" });
		assert.strictEqual(event.code, "enter");
	});

	it("bubbles and is cancelable by default", () => {
		const node = createNode("ink-box");
		const event = new KeyboardEvent(node, { key: "a" });
		assert.strictEqual(event.bubbles, true);
		assert.strictEqual(event.cancelable, true);
	});
});

// --
// TuiEngine.handleInput

describe("TuiEngine.handleInput", () => {
	// Ensure deterministic legacy-mode parsing regardless of prior test state.
	it("dispatches KeyboardEvent to the focused element", () => {
		setKittyProtocolActive(false);
		const terminal = new VirtualTerminal(20, 10);
		terminal.start(
			() => undefined,
			() => undefined,
		);
		const engine = new TuiEngine(terminal);

		const target = engine.createElement("ink-box");
		engine.appendChild(engine.rootNode, target);
		engine.focusNode(target);

		let received: KeyboardEvent | undefined;
		let receivedCurrent: TuiElement | null | undefined;
		target.addEventListener("keydown", (e) => {
			received = e as KeyboardEvent;
			receivedCurrent = e.currentTarget;
		});

		engine.handleInput("a");

		assert.ok(received !== undefined, "listener should have been called");
		assert.strictEqual(received!.key, "a");
		assert.strictEqual(received!.ctrlKey, false);
		assert.strictEqual(received!.target, target);
		assert.strictEqual(receivedCurrent, target);

		engine.stop();
		terminal.stop();
	});

	it("parses ctrl modifier from ctrl+key input", () => {
		setKittyProtocolActive(false);
		const terminal = new VirtualTerminal(20, 10);
		terminal.start(
			() => undefined,
			() => undefined,
		);
		const engine = new TuiEngine(terminal);

		const target = engine.createElement("ink-box");
		engine.appendChild(engine.rootNode, target);
		engine.focusNode(target);

		let received: KeyboardEvent | undefined;
		target.addEventListener("keydown", (e) => {
			received = e as KeyboardEvent;
		});

		engine.handleInput("\x03"); // ctrl+c

		assert.ok(received !== undefined);
		assert.strictEqual(received!.key, "c");
		assert.strictEqual(received!.ctrlKey, true);

		engine.stop();
		terminal.stop();
	});

	it("dispatches to rootNode when no element has focus", () => {
		setKittyProtocolActive(false);
		const terminal = new VirtualTerminal(20, 10);
		terminal.start(
			() => undefined,
			() => undefined,
		);
		const engine = new TuiEngine(terminal);

		let received: KeyboardEvent | undefined;
		engine.rootNode.addEventListener("keydown", (e) => {
			received = e as KeyboardEvent;
		});

		engine.handleInput("a");

		assert.ok(received !== undefined);
		assert.strictEqual(received!.target, engine.rootNode);

		engine.stop();
		terminal.stop();
	});

	it("bubbles keydown from target to rootNode", () => {
		setKittyProtocolActive(false);
		const terminal = new VirtualTerminal(20, 10);
		terminal.start(
			() => undefined,
			() => undefined,
		);
		const engine = new TuiEngine(terminal);

		const target = engine.createElement("ink-box");
		engine.appendChild(engine.rootNode, target);
		engine.focusNode(target);

		const path: TuiElement[] = [];
		target.addEventListener("keydown", (e) => path.push(e.currentTarget!));
		engine.rootNode.addEventListener("keydown", (e) => path.push(e.currentTarget!));

		engine.handleInput("a");

		assert.deepStrictEqual(path, [target, engine.rootNode]);

		engine.stop();
		terminal.stop();
	});

	it("calls onUnhandledKey when default is not prevented", () => {
		setKittyProtocolActive(false);
		const terminal = new VirtualTerminal(20, 10);
		terminal.start(
			() => undefined,
			() => undefined,
		);
		const engine = new TuiEngine(terminal);

		const target = engine.createElement("ink-box");
		engine.appendChild(engine.rootNode, target);
		engine.focusNode(target);

		let unhandled: string | undefined;
		engine.onUnhandledKey = (data) => {
			unhandled = data;
		};

		engine.handleInput("a");
		assert.strictEqual(unhandled, "a");

		engine.stop();
		terminal.stop();
	});

	it("does not call onUnhandledKey when default is prevented", () => {
		setKittyProtocolActive(false);
		const terminal = new VirtualTerminal(20, 10);
		terminal.start(
			() => undefined,
			() => undefined,
		);
		const engine = new TuiEngine(terminal);

		const target = engine.createElement("ink-box");
		engine.appendChild(engine.rootNode, target);
		engine.focusNode(target);
		target.addEventListener("keydown", (e) => e.preventDefault());

		let unhandled: string | undefined;
		engine.onUnhandledKey = (data) => {
			unhandled = data;
		};

		engine.handleInput("a");
		assert.strictEqual(unhandled, undefined);

		engine.stop();
		terminal.stop();
	});

	it("stopPropagation prevents bubbling to rootNode", () => {
		setKittyProtocolActive(false);
		const terminal = new VirtualTerminal(20, 10);
		terminal.start(
			() => undefined,
			() => undefined,
		);
		const engine = new TuiEngine(terminal);

		const target = engine.createElement("ink-box");
		engine.appendChild(engine.rootNode, target);
		engine.focusNode(target);

		let rootCalled = false;
		target.addEventListener("keydown", (e) => e.stopPropagation());
		engine.rootNode.addEventListener("keydown", () => {
			rootCalled = true;
		});

		engine.handleInput("a");
		assert.strictEqual(rootCalled, false);

		engine.stop();
		terminal.stop();
	});
});
