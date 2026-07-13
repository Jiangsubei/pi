/**
 * Bridge layer tests — wrapComponent + measure + paint.
 *
 * Exercises the P2 bridge that wraps legacy {@link Component} instances
 * (box/text/editor/…) as `ink-legacy` {@link TuiElement} nodes so they
 * participate in the new Yoga-backed DOM tree.
 *
 * Two test styles are used:
 * - Integration tests via {@link TuiEngine} + {@link VirtualTerminal}
 *   for end-to-end behavior (measure, render to terminal).
 * - Unit tests via direct DOM construction + {@link renderNode} +
 *   {@link Screen} for precise assertions on cells, styleId, and
 *   {@link TuiElement.legacyCursor}.
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import { wrapComponent } from "../src/bridge/adapter.ts";
import { renderLegacy } from "../src/bridge/render.ts";
import { Box } from "../src/components/box.ts";
import { Text } from "../src/components/text.ts";
import { appendChild, createNode, type TuiElement } from "../src/dom/tree.ts";
import { TuiEngine } from "../src/engine.ts";
import { Output } from "../src/output/output.ts";
import { renderNode } from "../src/output/render-node.ts";
import { Screen } from "../src/screen/screen.ts";
import { type Component, CURSOR_MARKER } from "../src/tui.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

// --
// Helpers

/**
 * Build a DOM tree, lay it out, paint it to a fresh Screen, and return
 * the Screen. Mirrors the helper in render.test.ts but local so this
 * file stays self-contained.
 */
function paintTree(root: TuiElement, width: number, height: number): Screen {
	root.yogaNode.setWidth(width);
	root.yogaNode.setHeight(height);
	root.yogaNode.calculateLayout();
	const screen = new Screen(width, height);
	const output = new Output(screen);
	renderNode(root, output);
	output.flush();
	return screen;
}

/** Read a row from the screen as a string (skipping width=0 trailing halves). */
function rowString(screen: Screen, y: number): string {
	let s = "";
	for (let x = 0; x < screen.width; x++) {
		const cell = screen.getCell(x, y);
		if (cell.width === 0) continue;
		s += cell.char;
	}
	return s;
}

/** Trim trailing spaces from a screen row for assertion readability. */
function rowTrimmed(screen: Screen, y: number): string {
	return rowString(screen, y).trimEnd();
}

/**
 * Minimal Component that emits CURSOR_MARKER at a fixed position.
 * Used to test cursor extraction without the Editor's complexity.
 */
class CursorEmittingComponent implements Component {
	private readonly prefix: string;
	private readonly suffix: string;

	constructor(prefix: string, suffix: string = "") {
		this.prefix = prefix;
		this.suffix = suffix;
	}

	render(_width: number): string[] {
		return [this.prefix + CURSOR_MARKER + this.suffix];
	}

	invalidate(): void {
		// Stateless component — nothing to invalidate.
	}
}

/**
 * Minimal Component that emits a fixed number of lines. Used to test
 * the measure function without depending on Box/Text padding behavior.
 */
class FixedLinesComponent implements Component {
	private readonly lines: string[];

	constructor(lines: string[]) {
		this.lines = lines;
	}

	render(_width: number): string[] {
		return this.lines;
	}

	invalidate(): void {
		// Stateless component — nothing to invalidate.
	}
}

// --
// SubTask 15.1: wrapComponent factory

describe("bridge: wrapComponent adapter", () => {
	it("wraps a Component as an ink-legacy node with component field set", () => {
		const box = new Box(0, 0);
		box.addChild(new Text("Hello from legacy", 0, 0));
		const node = wrapComponent(box);
		assert.strictEqual(node.nodeName, "ink-legacy");
		assert.strictEqual(node.component, box);
	});

	it("installs a Yoga measure function so the node is sized by render(width)", () => {
		const component = new FixedLinesComponent(["a", "b", "c"]);
		const node = wrapComponent(component);
		// Attach to a root and lay out so Yoga calls the measure func.
		const root = createNode("ink-root", { flexDirection: "column", width: "100%", height: "100%" });
		appendChild(root, node);
		paintTree(root, 80, 24);
		// The component emits 3 lines, so Yoga should size the node to
		// height 3 (no flex grow, plenty of room in the 24-row root).
		assert.strictEqual(
			node.yogaNode.getComputedHeight(),
			3,
			`legacy node height should be 3 (3 lines), got ${node.yogaNode.getComputedHeight()}`,
		);
	});

	it("applies style to the wrapper node (padding participates in layout)", () => {
		const component = new FixedLinesComponent(["x"]);
		const node = wrapComponent(component, { paddingLeft: 2, paddingRight: 2 });
		const root = createNode("ink-root", { flexDirection: "column", width: "100%", height: "100%" });
		appendChild(root, node);
		paintTree(root, 80, 24);
		// Width = 80 (stretched), content width = 80 - 2 - 2 = 76.
		assert.strictEqual(node.yogaNode.getComputedWidth(), 80);
	});
});

// --
// SubTask 16.1: measure function

describe("bridge: measure function", () => {
	it("measures height as the line count returned by render(width)", () => {
		const component = new FixedLinesComponent(["line1", "line2", "line3", "line4", "line5"]);
		const node = wrapComponent(component);
		const root = createNode("ink-root", { flexDirection: "column", width: "100%", height: "100%" });
		appendChild(root, node);
		paintTree(root, 80, 24);
		assert.strictEqual(node.yogaNode.getComputedHeight(), 5);
	});

	it("measures height 0 for an empty component", () => {
		const component = new FixedLinesComponent([]);
		const node = wrapComponent(component);
		const root = createNode("ink-root", { flexDirection: "column", width: "100%", height: "100%" });
		appendChild(root, node);
		paintTree(root, 80, 24);
		// Zero lines → zero height. Yoga may clamp to 0; the node is
		// skipped by renderNode (height <= 0 check) so no content is
		// painted, which is correct for an empty component.
		assert.strictEqual(node.yogaNode.getComputedHeight(), 0);
	});

	it("measures a Box with Text children at the combined line count", () => {
		// Box(0,0) with 3 Text(0,0) children → 3 lines total.
		const box = new Box(0, 0);
		box.addChild(new Text("Line 1", 0, 0));
		box.addChild(new Text("Line 2", 0, 0));
		box.addChild(new Text("Line 3", 0, 0));
		const node = wrapComponent(box);
		const root = createNode("ink-root", { flexDirection: "column", width: "100%", height: "100%" });
		appendChild(root, node);
		paintTree(root, 80, 24);
		assert.strictEqual(node.yogaNode.getComputedHeight(), 3);
	});
});

// --
// SubTask 17.1: paint (renderLegacy)

describe("bridge: renderLegacy paint", () => {
	it("writes component text content to the screen", () => {
		const component = new FixedLinesComponent(["Legacy content"]);
		const node = wrapComponent(component);
		const root = createNode("ink-root", { flexDirection: "column", width: "100%", height: "100%" });
		appendChild(root, node);
		const screen = paintTree(root, 80, 24);
		assert.strictEqual(rowTrimmed(screen, 0), "Legacy content", `screen row 0 should contain "Legacy content"`);
	});

	it("writes multiple lines at the correct screen rows", () => {
		const component = new FixedLinesComponent(["AAA", "BBB", "CCC"]);
		const node = wrapComponent(component);
		const root = createNode("ink-root", { flexDirection: "column", width: "100%", height: "100%" });
		appendChild(root, node);
		const screen = paintTree(root, 80, 24);
		assert.strictEqual(rowTrimmed(screen, 0), "AAA");
		assert.strictEqual(rowTrimmed(screen, 1), "BBB");
		assert.strictEqual(rowTrimmed(screen, 2), "CCC");
	});

	it("clips lines beyond the node height", () => {
		// 5 lines of content but node height constrained to 2.
		const component = new FixedLinesComponent(["L1", "L2", "L3", "L4", "L5"]);
		const node = wrapComponent(component, { height: 2 });
		const root = createNode("ink-root", { flexDirection: "column", width: "100%", height: "100%" });
		appendChild(root, node);
		const screen = paintTree(root, 80, 24);
		assert.strictEqual(rowTrimmed(screen, 0), "L1");
		assert.strictEqual(rowTrimmed(screen, 1), "L2");
		// Row 2 should be empty (clipped, not rendered).
		assert.strictEqual(rowTrimmed(screen, 2), "");
	});

	it("strips ANSI sequences from component output", () => {
		// A component that emits styled text via ANSI SGR. The bridge
		// strips the ANSI and writes plain text (component-specific
		// styling is deferred to P5; only inherited styles apply).
		const ansiComponent = new FixedLinesComponent(["\x1b[31mRed Text\x1b[0m"]);
		const node = wrapComponent(ansiComponent);
		const root = createNode("ink-root", { flexDirection: "column", width: "100%", height: "100%" });
		appendChild(root, node);
		const screen = paintTree(root, 80, 24);
		// The ANSI bytes should NOT appear as visible cells — the
		// bridge strips them, leaving just "Red Text".
		assert.strictEqual(rowTrimmed(screen, 0), "Red Text");
	});

	it("inherits TextStyles from ancestor ink-box nodes", () => {
		// Parent ink-box has color: "ansi:red". The legacy node's text
		// should be interned with that inherited color.
		const component = new FixedLinesComponent(["Hello"]);
		const legacy = wrapComponent(component);
		const box = createNode("ink-box", { color: "ansi:red" });
		appendChild(box, legacy);
		const root = createNode("ink-root", { flexDirection: "column", width: "100%", height: "100%" });
		appendChild(root, box);
		const screen = paintTree(root, 80, 24);
		const cell = screen.getCell(0, 0);
		assert.notStrictEqual(cell.styleId, 0, "cell should have a non-default styleId (inherited red)");
		const style = screen.stylePool.get(cell.styleId);
		assert.strictEqual(style?.color, "ansi:red", `inherited style color should be "ansi:red"`);
	});

	it("extracts CURSOR_MARKER position to node.legacyCursor", () => {
		// Component emits CURSOR_MARKER between "Hello" and "World".
		// The bridge should record col=5 (width of "Hello"), row=0.
		const component = new CursorEmittingComponent("Hello", "World");
		const node = wrapComponent(component);
		const root = createNode("ink-root", { flexDirection: "column", width: "100%", height: "100%" });
		appendChild(root, node);
		paintTree(root, 80, 24);
		assert.ok(node.legacyCursor !== undefined, "legacyCursor should be set");
		assert.strictEqual(node.legacyCursor.row, 0, "cursor row should be 0");
		assert.strictEqual(node.legacyCursor.col, 5, `cursor col should be 5 (width of "Hello")`);
	});

	it("does not emit CURSOR_MARKER bytes as visible cells", () => {
		// The CURSOR_MARKER is a zero-width APC sequence. The bridge
		// extracts its position and strips it; the inner bytes
		// ("_pi:c") must NOT appear as visible cells.
		const component = new CursorEmittingComponent("AB", "CD");
		const node = wrapComponent(component);
		const root = createNode("ink-root", { flexDirection: "column", width: "100%", height: "100%" });
		appendChild(root, node);
		const screen = paintTree(root, 80, 24);
		const row = rowString(screen, 0);
		assert.ok(row.startsWith("ABCD"), `row should start with "ABCD" (marker stripped), got: ${JSON.stringify(row)}`);
		assert.ok(!row.includes("_pi:c"), "row must not contain CURSOR_MARKER inner bytes");
	});

	it("resets legacyCursor to undefined when the component stops emitting a marker", () => {
		// A component that emits a marker on the first render but not on
		// the second. The bridge should clear legacyCursor.
		class ToggleCursorComponent implements Component {
			public emitMarker = true;
			render(_width: number): string[] {
				return this.emitMarker ? [`x${CURSOR_MARKER}y`] : ["xy"];
			}
			invalidate(): void {}
		}
		const component = new ToggleCursorComponent();
		const node = wrapComponent(component);
		const root = createNode("ink-root", { flexDirection: "column", width: "100%", height: "100%" });
		appendChild(root, node);

		// First paint: marker present → legacyCursor set.
		paintTree(root, 80, 24);
		assert.ok(node.legacyCursor !== undefined, "legacyCursor should be set on first paint");

		// Second paint: no marker → legacyCursor cleared.
		component.emitMarker = false;
		paintTree(root, 80, 24);
		assert.strictEqual(node.legacyCursor, undefined, "legacyCursor should be cleared on second paint");
	});

	it("is a no-op when node.component is undefined", () => {
		// An ink-legacy node created directly (not via wrapComponent)
		// has no component. renderLegacy should be a no-op.
		const node = createNode("ink-legacy");
		const screen = new Screen(10, 1);
		const output = new Output(screen);
		renderLegacy(node, output, 0, 0, 10, 1, {});
		output.flush();
		// Screen should be all empty cells.
		assert.strictEqual(screen.getCell(0, 0).char, " ");
		assert.strictEqual(node.legacyCursor, undefined);
	});
});

// --
// Integration: TuiEngine + VirtualTerminal

describe("bridge: TuiEngine integration", () => {
	it("renders a wrapped Box+Text to the terminal via the engine", async () => {
		const terminal = new VirtualTerminal(80, 24);
		terminal.start(
			() => undefined,
			() => undefined,
		);
		const engine = new TuiEngine(terminal);

		const box = new Box(0, 0);
		box.addChild(new Text("Legacy content", 0, 0));
		const node = engine.wrapComponent(box);
		engine.appendChild(engine.rootNode, node);

		engine.start();
		await terminal.waitForRender();

		const viewport = terminal.getViewport();
		const output = viewport.join("\n");
		assert.ok(
			output.includes("Legacy content"),
			`Expected terminal to contain "Legacy content", got: ${JSON.stringify(viewport.slice(0, 3))}`,
		);

		engine.stop();
		terminal.stop();
	});

	it("schedules a re-render when a wrapped component is appended", async () => {
		const terminal = new VirtualTerminal(80, 24);
		terminal.start(
			() => undefined,
			() => undefined,
		);
		const engine = new TuiEngine(terminal);

		const node = engine.wrapComponent(new FixedLinesComponent(["First frame"]));
		engine.appendChild(engine.rootNode, node);

		engine.start();
		await terminal.waitForRender();

		let viewport = terminal.getViewport();
		assert.ok(viewport.join("\n").includes("First frame"), `first frame should contain "First frame"`);

		// Replace the component's content by wrapping a new one and
		// appending it (the old node stays but a new one is added
		// below it).
		const node2 = engine.wrapComponent(new FixedLinesComponent(["Second frame"]));
		engine.appendChild(engine.rootNode, node2);
		await terminal.waitForRender();

		viewport = terminal.getViewport();
		assert.ok(viewport.join("\n").includes("Second frame"), `second frame should contain "Second frame"`);

		engine.stop();
		terminal.stop();
	});
});
