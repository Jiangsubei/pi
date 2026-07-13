/**
 * FocusManager tests — ported from Claude Code's focus.ts, adapted for
 * Pi's TuiElement tree and Focusable component interface.
 *
 * Coverage:
 * 1. focus: sets activeElement, syncs component.focused = true
 * 2. blur: clears activeElement, syncs component.focused = false
 * 3. pushFocus/popFocus: save and restore focus state
 * 4. handleNodeRemoved: blur when active element is removed; stack cleanup
 * 5. handleAutoFocus: auto-focus first focusable descendant
 * 6. focusNext/focusPrevious: Tab / Shift+Tab cycle
 * 7. isFocused: check whether a node is the active element
 * 8. integration: wrapComponent Focusable + engine.focusNode syncs focused
 * 9. IME cursor positioning: legacyCursor → terminal CUP sequence
 *
 * Two test styles:
 * - Unit tests on FocusManager directly (with hand-built TuiElement trees)
 * - Integration tests via TuiEngine + VirtualTerminal (end-to-end)
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import { wrapComponent } from "../src/bridge/adapter.ts";
import { appendChild, createNode, type TuiElement } from "../src/dom/tree.ts";
import { FocusManager } from "../src/engine/focus.ts";
import { TuiEngine } from "../src/engine.ts";
import { type Component, CURSOR_MARKER, type Focusable } from "../src/tui.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

// --
// Helpers

/**
 * Minimal Component that implements Focusable. The `focused` field is
 * set by FocusManager.syncFocusable; render() is content-only.
 */
class FocusableComponent implements Component, Focusable {
	focused = false;
	private readonly lines: string[];

	constructor(lines: string[] = ["content"]) {
		this.lines = lines;
	}

	render(_width: number): string[] {
		return this.lines;
	}

	invalidate(): void {
		// Stateless — nothing to invalidate.
	}
}

/**
 * Focusable Component that emits CURSOR_MARKER when focused. Mirrors the
 * real Editor contract: when focused, the component emits the zero-width
 * APC sequence at the cursor position; the bridge extracts the position
 * to node.legacyCursor during the paint pass.
 */
class FocusableCursorComponent implements Component, Focusable {
	focused = false;

	render(_width: number): string[] {
		// When focused, emit the marker between "Hello" and "World" →
		// legacyCursor = { row: 0, col: 5 }.
		return this.focused ? [`Hello${CURSOR_MARKER}World`] : ["HelloWorld"];
	}

	invalidate(): void {
		// Stateless — nothing to invalidate.
	}
}

/** Non-focusable Component (no `focused` field) for tree-walk tests. */
class PlainComponent implements Component {
	private readonly lines: string[];

	constructor(lines: string[] = ["plain"]) {
		this.lines = lines;
	}

	render(_width: number): string[] {
		return this.lines;
	}

	invalidate(): void {
		// Stateless — nothing to invalidate.
	}
}

/** Wrap a Focusable component as an ink-legacy node. */
function wrapFocusable(component: Component & Focusable): TuiElement {
	return wrapComponent(component);
}

/** Build a root with `nodes` appended as direct children. */
function makeTree(...nodes: TuiElement[]): TuiElement {
	const root = createNode("ink-root", { flexDirection: "column", width: "100%", height: "100%" });
	for (const node of nodes) {
		appendChild(root, node);
	}
	return root;
}

// --
// SubTask 19.1: focus

describe("FocusManager: focus", () => {
	it("sets activeElement to the focused node", () => {
		const fm = new FocusManager();
		const component = new FocusableComponent();
		const node = wrapFocusable(component);
		assert.strictEqual(fm.getActiveElement(), undefined, "no active element before focus");
		fm.focus(node);
		assert.strictEqual(fm.getActiveElement(), node, "active element should be the focused node");
	});

	it("syncs component.focused = true on focus", () => {
		const fm = new FocusManager();
		const component = new FocusableComponent();
		const node = wrapFocusable(component);
		assert.strictEqual(component.focused, false, "component.focused should start false");
		fm.focus(node);
		assert.strictEqual(component.focused, true, "component.focused should be true after focus");
	});

	it("blurs the previously focused element when focusing a new one", () => {
		const fm = new FocusManager();
		const a = new FocusableComponent();
		const b = new FocusableComponent();
		const nodeA = wrapFocusable(a);
		const nodeB = wrapFocusable(b);
		fm.focus(nodeA);
		assert.strictEqual(a.focused, true, "A should be focused");
		fm.focus(nodeB);
		assert.strictEqual(a.focused, false, "A should be blurred when B is focused");
		assert.strictEqual(b.focused, true, "B should be focused");
		assert.strictEqual(fm.getActiveElement(), nodeB, "active element should be B");
	});

	it("focus(undefined) blurs without focusing a new element", () => {
		const fm = new FocusManager();
		const component = new FocusableComponent();
		const node = wrapFocusable(component);
		fm.focus(node);
		assert.strictEqual(component.focused, true);
		fm.focus(undefined);
		assert.strictEqual(component.focused, false, "component should be blurred");
		assert.strictEqual(fm.getActiveElement(), undefined, "no active element after focus(undefined)");
	});

	it("does not throw when focusing with no prior active element", () => {
		const fm = new FocusManager();
		const component = new FocusableComponent();
		const node = wrapFocusable(component);
		// No prior focus — should not throw.
		fm.focus(node);
		assert.strictEqual(component.focused, true);
	});
});

// --
// SubTask 19.2: blur

describe("FocusManager: blur", () => {
	it("clears activeElement", () => {
		const fm = new FocusManager();
		const component = new FocusableComponent();
		const node = wrapFocusable(component);
		fm.focus(node);
		fm.blur();
		assert.strictEqual(fm.getActiveElement(), undefined, "no active element after blur");
	});

	it("syncs component.focused = false on blur", () => {
		const fm = new FocusManager();
		const component = new FocusableComponent();
		const node = wrapFocusable(component);
		fm.focus(node);
		assert.strictEqual(component.focused, true);
		fm.blur();
		assert.strictEqual(component.focused, false, "component.focused should be false after blur");
	});

	it("is a no-op when no element has focus", () => {
		const fm = new FocusManager();
		// Should not throw.
		fm.blur();
		assert.strictEqual(fm.getActiveElement(), undefined);
	});
});

// --
// SubTask 19.3: pushFocus / popFocus

describe("FocusManager: pushFocus / popFocus", () => {
	it("popFocus restores the active element saved by pushFocus", () => {
		const fm = new FocusManager();
		const a = new FocusableComponent();
		const b = new FocusableComponent();
		const nodeA = wrapFocusable(a);
		const nodeB = wrapFocusable(b);

		fm.focus(nodeA);
		fm.pushFocus();
		fm.focus(nodeB);
		assert.strictEqual(fm.getActiveElement(), nodeB, "B should be active after focus");
		assert.strictEqual(a.focused, false, "A should be blurred while B is active");
		assert.strictEqual(b.focused, true, "B should be focused");

		fm.popFocus();
		assert.strictEqual(fm.getActiveElement(), nodeA, "A should be restored after popFocus");
		assert.strictEqual(a.focused, true, "A should be focused again after popFocus");
		assert.strictEqual(b.focused, false, "B should be blurred after popFocus");
	});

	it("popFocus is a no-op when the stack is empty", () => {
		const fm = new FocusManager();
		// Should not throw.
		fm.popFocus();
		assert.strictEqual(fm.getActiveElement(), undefined);
	});

	it("pushFocus when no element has focus saves undefined", () => {
		const fm = new FocusManager();
		const a = new FocusableComponent();
		const nodeA = wrapFocusable(a);
		// No focus before pushFocus — saves undefined.
		fm.pushFocus();
		fm.focus(nodeA);
		assert.strictEqual(fm.getActiveElement(), nodeA);
		assert.strictEqual(a.focused, true);
		fm.popFocus();
		// Restored to undefined (the state at push time).
		assert.strictEqual(fm.getActiveElement(), undefined);
		assert.strictEqual(a.focused, false, "A should be blurred after restoring undefined");
	});

	it("multiple pushFocus/popFocus calls nest correctly (LIFO)", () => {
		const fm = new FocusManager();
		const a = new FocusableComponent();
		const b = new FocusableComponent();
		const c = new FocusableComponent();
		const nodeA = wrapFocusable(a);
		const nodeB = wrapFocusable(b);
		const nodeC = wrapFocusable(c);

		fm.focus(nodeA);
		fm.pushFocus(); // save A
		fm.focus(nodeB);
		fm.pushFocus(); // save B
		fm.focus(nodeC);
		assert.strictEqual(fm.getActiveElement(), nodeC);

		fm.popFocus(); // restore B
		assert.strictEqual(fm.getActiveElement(), nodeB);
		assert.strictEqual(c.focused, false);

		fm.popFocus(); // restore A
		assert.strictEqual(fm.getActiveElement(), nodeA);
		assert.strictEqual(b.focused, false);
	});

	it("limits the stack depth to MAX_FOCUS_STACK_DEPTH (32)", () => {
		const fm = new FocusManager();
		const component = new FocusableComponent();
		const node = wrapFocusable(component);
		fm.focus(node);
		// Push 40 entries — only the first 32 should be stored.
		for (let i = 0; i < 40; i++) {
			fm.pushFocus();
		}
		// Pop 32 times — each should restore (and re-focus) the node.
		for (let i = 0; i < 32; i++) {
			fm.popFocus();
		}
		assert.strictEqual(fm.getActiveElement(), node, "after 32 pops, node should be active");
		// The 33rd pop should be a no-op (stack is empty).
		fm.popFocus();
		assert.strictEqual(fm.getActiveElement(), node, "33rd pop should not change active element");
	});
});

// --
// SubTask 19.4: handleNodeRemoved

describe("FocusManager: handleNodeRemoved", () => {
	it("blurs the active element when it is removed", () => {
		const fm = new FocusManager();
		const component = new FocusableComponent();
		const node = wrapFocusable(component);
		fm.focus(node);
		fm.handleNodeRemoved(node);
		assert.strictEqual(fm.getActiveElement(), undefined, "no active element after removal");
		assert.strictEqual(component.focused, false, "component should be blurred after removal");
	});

	it("does not blur when a non-active node is removed", () => {
		const fm = new FocusManager();
		const a = new FocusableComponent();
		const b = new FocusableComponent();
		const nodeA = wrapFocusable(a);
		const nodeB = wrapFocusable(b);
		fm.focus(nodeA);
		fm.handleNodeRemoved(nodeB);
		assert.strictEqual(fm.getActiveElement(), nodeA, "A should remain active");
		assert.strictEqual(a.focused, true, "A should remain focused");
	});

	it("removes stale entries from the focus stack", () => {
		const fm = new FocusManager();
		const a = new FocusableComponent();
		const b = new FocusableComponent();
		const nodeA = wrapFocusable(a);
		const nodeB = wrapFocusable(b);

		fm.focus(nodeA);
		fm.pushFocus(); // save A
		fm.focus(nodeB);
		// Now stack = [A], active = B.
		// Remove A — it should be pruned from the stack.
		fm.handleNodeRemoved(nodeA);
		// popFocus should NOT restore A (it was pruned); the stack is now
		// empty so popFocus is a no-op and active remains B.
		fm.popFocus();
		assert.strictEqual(fm.getActiveElement(), nodeB, "active should remain B, not restored to A");
		assert.strictEqual(b.focused, true, "B should remain focused");
	});

	it("does not throw when removing a node not in the stack or active", () => {
		const fm = new FocusManager();
		const component = new FocusableComponent();
		const node = wrapFocusable(component);
		// No focus, no stack — should not throw.
		fm.handleNodeRemoved(node);
		assert.strictEqual(fm.getActiveElement(), undefined);
	});
});

// --
// SubTask 19.5: handleAutoFocus

describe("FocusManager: handleAutoFocus", () => {
	it("focuses the first focusable descendant in document order", () => {
		const fm = new FocusManager();
		const plain = wrapComponent(new PlainComponent());
		const aComp = new FocusableComponent();
		const bComp = new FocusableComponent();
		const a = wrapFocusable(aComp);
		const b = wrapFocusable(bComp);
		// Tree: root → [plain, box → [a, b]]
		// Document order: plain (not focusable), a (focusable).
		const box = createNode("ink-box");
		appendChild(box, a);
		appendChild(box, b);
		const root = makeTree(plain, box);

		fm.handleAutoFocus(root);
		assert.strictEqual(fm.getActiveElement(), a, "first focusable (a) should be auto-focused");
		assert.strictEqual(aComp.focused, true, "a.focused should be true");
		assert.strictEqual(bComp.focused, false, "b.focused should remain false");
	});

	it("is a no-op when an element already has focus", () => {
		const fm = new FocusManager();
		const aComp = new FocusableComponent();
		const bComp = new FocusableComponent();
		const a = wrapFocusable(aComp);
		const b = wrapFocusable(bComp);
		const root = makeTree(a, b);

		fm.focus(b);
		fm.handleAutoFocus(root);
		assert.strictEqual(fm.getActiveElement(), b, "B should remain focused, not auto-focused to A");
		assert.strictEqual(aComp.focused, false);
		assert.strictEqual(bComp.focused, true);
	});

	it("is a no-op when no focusable descendant exists", () => {
		const fm = new FocusManager();
		const plain = wrapComponent(new PlainComponent());
		const root = makeTree(plain);
		fm.handleAutoFocus(root);
		assert.strictEqual(fm.getActiveElement(), undefined, "no active element when no focusable exists");
	});

	it("skips non-focusable components during the walk", () => {
		const fm = new FocusManager();
		const plain1 = wrapComponent(new PlainComponent());
		const plain2 = wrapComponent(new PlainComponent());
		const targetComp = new FocusableComponent();
		const target = wrapFocusable(targetComp);
		const root = makeTree(plain1, plain2, target);
		fm.handleAutoFocus(root);
		assert.strictEqual(fm.getActiveElement(), target, "should skip plain components and focus target");
	});
});

// --
// SubTask 19.6: focusNext / focusPrevious

describe("FocusManager: focusNext / focusPrevious", () => {
	it("focusNext cycles through focusable elements in document order", () => {
		const fm = new FocusManager();
		const a = wrapFocusable(new FocusableComponent());
		const b = wrapFocusable(new FocusableComponent());
		const c = wrapFocusable(new FocusableComponent());
		const root = makeTree(a, b, c);

		// No active element → first.
		fm.focusNext(root);
		assert.strictEqual(fm.getActiveElement(), a, "first focusNext should focus A");

		fm.focusNext(root);
		assert.strictEqual(fm.getActiveElement(), b, "second focusNext should focus B");

		fm.focusNext(root);
		assert.strictEqual(fm.getActiveElement(), c, "third focusNext should focus C");

		// Wrap around.
		fm.focusNext(root);
		assert.strictEqual(fm.getActiveElement(), a, "fourth focusNext should wrap to A");
	});

	it("focusPrevious cycles in reverse document order", () => {
		const fm = new FocusManager();
		const a = wrapFocusable(new FocusableComponent());
		const b = wrapFocusable(new FocusableComponent());
		const c = wrapFocusable(new FocusableComponent());
		const root = makeTree(a, b, c);

		// No active element → last.
		fm.focusPrevious(root);
		assert.strictEqual(fm.getActiveElement(), c, "first focusPrevious should focus C (last)");

		fm.focusPrevious(root);
		assert.strictEqual(fm.getActiveElement(), b, "second focusPrevious should focus B");

		fm.focusPrevious(root);
		assert.strictEqual(fm.getActiveElement(), a, "third focusPrevious should focus A");

		// Wrap around.
		fm.focusPrevious(root);
		assert.strictEqual(fm.getActiveElement(), c, "fourth focusPrevious should wrap to C");
	});

	it("focusNext and focusPrevious sync component.focused correctly", () => {
		const fm = new FocusManager();
		const aComp = new FocusableComponent();
		const bComp = new FocusableComponent();
		const a = wrapFocusable(aComp);
		const b = wrapFocusable(bComp);
		const root = makeTree(a, b);

		fm.focusNext(root);
		assert.strictEqual(aComp.focused, true, "A should be focused");
		assert.strictEqual(bComp.focused, false, "B should be blurred");

		fm.focusNext(root);
		assert.strictEqual(aComp.focused, false, "A should be blurred after moving to B");
		assert.strictEqual(bComp.focused, true, "B should be focused");
	});

	it("focusNext is a no-op when there are no focusable elements", () => {
		const fm = new FocusManager();
		const plain = wrapComponent(new PlainComponent());
		const root = makeTree(plain);
		fm.focusNext(root);
		assert.strictEqual(fm.getActiveElement(), undefined, "no active element when no focusable exists");
	});

	it("focusPrevious is a no-op when there are no focusable elements", () => {
		const fm = new FocusManager();
		const plain = wrapComponent(new PlainComponent());
		const root = makeTree(plain);
		fm.focusPrevious(root);
		assert.strictEqual(fm.getActiveElement(), undefined);
	});

	it("focusNext finds focusable nodes nested in subtrees", () => {
		const fm = new FocusManager();
		const a = wrapFocusable(new FocusableComponent());
		const b = wrapFocusable(new FocusableComponent());
		// Tree: root → [box1 → [a], box2 → [b]]
		const box1 = createNode("ink-box");
		const box2 = createNode("ink-box");
		appendChild(box1, a);
		appendChild(box2, b);
		const root = makeTree(box1, box2);

		fm.focusNext(root);
		assert.strictEqual(fm.getActiveElement(), a, "should focus A (first in document order)");

		fm.focusNext(root);
		assert.strictEqual(fm.getActiveElement(), b, "should focus B (second in document order)");
	});
});

// --
// SubTask 19.7: isFocused

describe("FocusManager: isFocused", () => {
	it("returns true for the active element", () => {
		const fm = new FocusManager();
		const component = new FocusableComponent();
		const node = wrapFocusable(component);
		fm.focus(node);
		assert.strictEqual(fm.isFocused(node), true, "isFocused should return true for active element");
	});

	it("returns false for non-active elements", () => {
		const fm = new FocusManager();
		const a = wrapFocusable(new FocusableComponent());
		const b = wrapFocusable(new FocusableComponent());
		fm.focus(a);
		assert.strictEqual(fm.isFocused(b), false, "isFocused should return false for non-active element");
	});

	it("returns false when no element has focus", () => {
		const fm = new FocusManager();
		const node = wrapFocusable(new FocusableComponent());
		assert.strictEqual(fm.isFocused(node), false, "isFocused should return false when no element has focus");
	});
});

// --
// SubTask 19.8: integration — TuiEngine + wrapComponent

describe("integration: TuiEngine.focusNode syncs component.focused", () => {
	it("engine.focusNode sets component.focused = true", async () => {
		const terminal = new VirtualTerminal(80, 24);
		terminal.start(
			() => undefined,
			() => undefined,
		);
		const engine = new TuiEngine(terminal);
		const component = new FocusableComponent();
		const node = engine.wrapComponent(component);
		engine.appendChild(engine.rootNode, node);

		engine.start();
		await terminal.waitForRender();

		assert.strictEqual(component.focused, false, "component should start unfocused");
		engine.focusNode(node);
		await terminal.waitForRender();
		assert.strictEqual(component.focused, true, "component should be focused after engine.focusNode");
		assert.strictEqual(engine.getFocusManager().getActiveElement(), node, "active element should be the node");

		engine.stop();
		terminal.stop();
	});

	it("engine.blurActiveElement sets component.focused = false", async () => {
		const terminal = new VirtualTerminal(80, 24);
		terminal.start(
			() => undefined,
			() => undefined,
		);
		const engine = new TuiEngine(terminal);
		const component = new FocusableComponent();
		const node = engine.wrapComponent(component);
		engine.appendChild(engine.rootNode, node);

		engine.start();
		await terminal.waitForRender();
		engine.focusNode(node);
		await terminal.waitForRender();
		assert.strictEqual(component.focused, true);

		engine.blurActiveElement();
		await terminal.waitForRender();
		assert.strictEqual(component.focused, false, "component should be blurred after blurActiveElement");
		assert.strictEqual(engine.getFocusManager().getActiveElement(), undefined);

		engine.stop();
		terminal.stop();
	});

	it("engine.autoFocus focuses the first focusable descendant", async () => {
		const terminal = new VirtualTerminal(80, 24);
		terminal.start(
			() => undefined,
			() => undefined,
		);
		const engine = new TuiEngine(terminal);
		const a = new FocusableComponent();
		const b = new FocusableComponent();
		const nodeA = engine.wrapComponent(a);
		const nodeB = engine.wrapComponent(b);
		engine.appendChild(engine.rootNode, nodeA);
		engine.appendChild(engine.rootNode, nodeB);

		engine.start();
		await terminal.waitForRender();
		engine.autoFocus();
		await terminal.waitForRender();
		assert.strictEqual(a.focused, true, "A (first focusable) should be auto-focused");
		assert.strictEqual(b.focused, false, "B should remain unfocused");
		assert.strictEqual(engine.getFocusManager().getActiveElement(), nodeA);

		engine.stop();
		terminal.stop();
	});

	it("engine.focusNext cycles through focusable elements", async () => {
		const terminal = new VirtualTerminal(80, 24);
		terminal.start(
			() => undefined,
			() => undefined,
		);
		const engine = new TuiEngine(terminal);
		const a = new FocusableComponent();
		const b = new FocusableComponent();
		const c = new FocusableComponent();
		const nodeA = engine.wrapComponent(a);
		const nodeB = engine.wrapComponent(b);
		const nodeC = engine.wrapComponent(c);
		engine.appendChild(engine.rootNode, nodeA);
		engine.appendChild(engine.rootNode, nodeB);
		engine.appendChild(engine.rootNode, nodeC);

		engine.start();
		await terminal.waitForRender();

		engine.focusNext();
		await terminal.waitForRender();
		assert.strictEqual(a.focused, true, "A should be focused after first focusNext");

		engine.focusNext();
		await terminal.waitForRender();
		assert.strictEqual(a.focused, false, "A should be blurred");
		assert.strictEqual(b.focused, true, "B should be focused after second focusNext");

		engine.focusNext();
		await terminal.waitForRender();
		assert.strictEqual(c.focused, true, "C should be focused after third focusNext");

		// Wrap around.
		engine.focusNext();
		await terminal.waitForRender();
		assert.strictEqual(a.focused, true, "A should be focused again (wrap around)");

		engine.stop();
		terminal.stop();
	});

	it("engine.removeChild blurs the removed focused node", async () => {
		const terminal = new VirtualTerminal(80, 24);
		terminal.start(
			() => undefined,
			() => undefined,
		);
		const engine = new TuiEngine(terminal);
		const component = new FocusableComponent();
		const node = engine.wrapComponent(component);
		engine.appendChild(engine.rootNode, node);

		engine.start();
		await terminal.waitForRender();
		engine.focusNode(node);
		await terminal.waitForRender();
		assert.strictEqual(component.focused, true);

		engine.removeChild(engine.rootNode, node);
		await terminal.waitForRender();
		assert.strictEqual(component.focused, false, "component should be blurred after removeChild");
		assert.strictEqual(engine.getFocusManager().getActiveElement(), undefined, "no active element after removal");

		engine.stop();
		terminal.stop();
	});
});

// --
// SubTask 19.9: IME hardware cursor positioning

describe("integration: IME hardware cursor positioning", () => {
	it("positions the terminal cursor at the legacyCursor location when focused", async () => {
		const terminal = new VirtualTerminal(80, 24);
		terminal.start(
			() => undefined,
			() => undefined,
		);
		const engine = new TuiEngine(terminal);
		const component = new FocusableCursorComponent();
		const node = engine.wrapComponent(component);
		engine.appendChild(engine.rootNode, node);

		engine.start();
		await terminal.waitForRender();

		// Before focus: no marker emitted, cursor should be hidden.
		// (No assertion on cursor visibility — xterm.js doesn't expose it
		// directly. We assert the position after focus instead.)

		engine.focusNode(node);
		await terminal.waitForRender();

		// Component emits "Hello<MARKER>World" → legacyCursor = { row: 0, col: 5 }.
		// Node is a direct child of rootNode at (0, 0) with no border/padding,
		// so the absolute cursor position is (5, 0) (0-indexed).
		const pos = terminal.getCursorPosition();
		assert.strictEqual(pos.x, 5, `cursor X should be 5 (after "Hello"), got ${pos.x}`);
		assert.strictEqual(pos.y, 0, `cursor Y should be 0 (first row), got ${pos.y}`);

		engine.stop();
		terminal.stop();
	});

	it("hides the cursor when no active element has a legacyCursor", async () => {
		// When the active element emits no marker (or no element is focused),
		// positionImeCursor writes \x1b[?25l (DECTCEM reset = hide cursor).
		// We assert on the raw writes since xterm.js doesn't expose cursor
		// visibility via a public API.
		const writes: string[] = [];
		class CapturingTerminal extends VirtualTerminal {
			override write(data: string): void {
				writes.push(data);
				super.write(data);
			}
		}
		const terminal = new CapturingTerminal(80, 24);
		terminal.start(
			() => undefined,
			() => undefined,
		);
		const engine = new TuiEngine(terminal);
		const component = new FocusableComponent(["no cursor marker"]);
		const node = engine.wrapComponent(component);
		engine.appendChild(engine.rootNode, node);

		engine.start();
		await terminal.waitForRender();
		// Focus the node — component emits no CURSOR_MARKER, so legacyCursor
		// stays undefined and positionImeCursor writes \x1b[?25l.
		engine.focusNode(node);
		writes.length = 0;
		await terminal.waitForRender();

		const allWrites = writes.join("");
		assert.ok(
			allWrites.includes("\x1b[?25l"),
			`should hide cursor when active element has no legacyCursor, got: ${JSON.stringify(allWrites)}`,
		);

		engine.stop();
		terminal.stop();
	});

	it("shows the cursor when the active element emits a CURSOR_MARKER", async () => {
		const writes: string[] = [];
		class CapturingTerminal extends VirtualTerminal {
			override write(data: string): void {
				writes.push(data);
				super.write(data);
			}
		}
		const terminal = new CapturingTerminal(80, 24);
		terminal.start(
			() => undefined,
			() => undefined,
		);
		const engine = new TuiEngine(terminal);
		const component = new FocusableCursorComponent();
		const node = engine.wrapComponent(component);
		engine.appendChild(engine.rootNode, node);

		engine.start();
		await terminal.waitForRender();
		engine.focusNode(node);
		writes.length = 0;
		await terminal.waitForRender();

		const allWrites = writes.join("");
		assert.ok(
			allWrites.includes("\x1b[?25h"),
			`should show cursor when active element emits CURSOR_MARKER, got: ${JSON.stringify(allWrites)}`,
		);
		// CUP sequence: \x1b[1;6H (row 1, col 6 — 1-indexed; = row 0, col 5 0-indexed).
		assert.ok(
			allWrites.includes("\x1b[1;6H"),
			`should position cursor at (5, 0) via CUP, got: ${JSON.stringify(allWrites)}`,
		);

		engine.stop();
		terminal.stop();
	});
});
