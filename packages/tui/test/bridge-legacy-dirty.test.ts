/**
 * Regression test: legacy `ink-legacy` wrappers must be re-measured
 * every frame so that internal Component state changes (e.g. a
 * Container's `children` array, an Editor's buffer) are reflected
 * on screen.
 *
 * Background: the bridge wraps each legacy Component as an
 * `ink-legacy` DOM node with a Yoga measure function
 * ({@link setLegacyMeasureFunc}). Yoga caches measured heights and
 * skips re-measure for clean (`!isDirty_`) nodes. Because the new
 * engine cannot observe mutations inside a legacy Component (e.g.
 * `chatContainer.addChild(streamingComponent)`), the wrapper would
 * stay clean and Yoga would reuse the stale cached height — newly
 * added chat messages or tool calls would be rendered by
 * `renderLegacy` but clipped to the stale height, invisible on
 * screen.
 *
 * The renderer's `markLegacyNodesDirty` pass (in `diff/renderer.ts`)
 * marks every `ink-legacy` node dirty before each `calculateLayout`,
 * mirroring the legacy TUI's behavior of re-rendering every component
 * each frame. This test verifies that behavior.
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import { wrapComponent } from "../src/bridge/adapter.ts";
import { createRenderer, type Renderer } from "../src/diff/renderer.ts";
import { appendChild, createNode, type TuiElement } from "../src/dom/tree.ts";
import { Output } from "../src/output/output.ts";
import { renderNode } from "../src/output/render-node.ts";
import { Screen } from "../src/screen/screen.ts";
import { type Component, Container } from "../src/tui.ts";

class FixedLines implements Component {
	private lines: string[];
	constructor(lines: string[]) {
		this.lines = lines;
	}
	render(_width: number): string[] {
		return this.lines;
	}
	invalidate(): void {}
}

function rowTrimmed(screen: Screen, y: number): string {
	let s = "";
	for (let x = 0; x < screen.width; x++) {
		const cell = screen.getCell(x, y);
		if (cell.width === 0) continue;
		s += cell.char;
	}
	return s.trimEnd();
}

/**
 * Render a root node via the production renderer path (the same one
 * `TuiEngine.renderLoop` uses), then return the resulting Screen so
 * tests can inspect individual cells.
 *
 * The renderer's `markLegacyNodesDirty` pass runs before each
 * `calculateLayout`, so legacy wrappers are always re-measured.
 *
 * The renderer itself returns an ANSI string (the diff output written
 * to the terminal), but tests need a Screen for cell-level assertions.
 * So we re-run the paint step (Output/renderNode) onto a fresh Screen
 * after the renderer has run layout. Layout positions are cached on
 * the yogaNode, so the second paint writes to the same positions the
 * renderer would have used.
 */
function renderFrame(renderer: Renderer, root: TuiElement, width: number, height: number): Screen {
	renderer(root, width, height);
	const screen = new Screen(width, height);
	const output = new Output(screen);
	renderNode(root, output);
	output.flush();
	return screen;
}

describe("bridge: legacy wrapper re-measure on Container mutation", () => {
	it("re-measures when a child is appended to a Container", () => {
		const container = new Container();
		container.addChild(new FixedLines(["line1"]));
		const node = wrapComponent(container);
		const root = createNode("ink-root", { flexDirection: "column", width: "100%", height: "100%" });
		appendChild(root, node);

		const renderer = createRenderer();
		let screen = renderFrame(renderer, root, 80, 24);
		assert.strictEqual(rowTrimmed(screen, 0), "line1");
		assert.strictEqual(node.yogaNode.getComputedHeight(), 1);

		// Append a second line to the Container (real-world: new chat message
		// or tool call component added to chatContainer).
		container.addChild(new FixedLines(["line2"]));

		// Re-render via the production path: markLegacyNodesDirty invalidates
		// the wrapper, Yoga re-invokes measure, height becomes 2.
		screen = renderFrame(renderer, root, 80, 24);

		// Expected: row 1 should now contain "line2".
		// Bug (before fix): yoga measure cache returns stale height (1),
		// so renderLegacy writes only 1 line and "line2" never appears.
		assert.strictEqual(
			rowTrimmed(screen, 1),
			"line2",
			`row 1 should be "line2" after append; got "${rowTrimmed(screen, 1)}"`,
		);
		assert.strictEqual(
			node.yogaNode.getComputedHeight(),
			2,
			`node height should be 2 after append; got ${node.yogaNode.getComputedHeight()}`,
		);
	});

	it("re-measures when a child is removed from a Container", () => {
		const container = new Container();
		const line2 = new FixedLines(["line2"]);
		container.addChild(new FixedLines(["line1"]));
		container.addChild(line2);
		const node = wrapComponent(container);
		const root = createNode("ink-root", { flexDirection: "column", width: "100%", height: "100%" });
		appendChild(root, node);

		const renderer = createRenderer();
		let screen = renderFrame(renderer, root, 80, 24);
		assert.strictEqual(rowTrimmed(screen, 0), "line1");
		assert.strictEqual(rowTrimmed(screen, 1), "line2");
		assert.strictEqual(node.yogaNode.getComputedHeight(), 2);

		// Remove the second child (real-world: a message component removed
		// from chatContainer).
		container.removeChild(line2);

		screen = renderFrame(renderer, root, 80, 24);

		// Expected: row 1 should now be empty.
		assert.strictEqual(rowTrimmed(screen, 0), "line1");
		assert.strictEqual(
			rowTrimmed(screen, 1),
			"",
			`row 1 should be empty after remove; got "${rowTrimmed(screen, 1)}"`,
		);
		assert.strictEqual(
			node.yogaNode.getComputedHeight(),
			1,
			`node height should be 1 after remove; got ${node.yogaNode.getComputedHeight()}`,
		);
	});
});
