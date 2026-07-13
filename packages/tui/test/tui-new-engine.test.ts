/**
 * Tests for the optional new Yoga-backed engine integration in TUI.
 *
 * These tests verify that:
 *   1. Default behavior (PI_USE_NEW_TUI_ENGINE not set) uses the legacy
 *      render path — no TuiEngine is created.
 *   2. Setting PI_USE_NEW_TUI_ENGINE=1 creates a TuiEngine instance.
 *   3. addChild syncs the component into the TuiEngine's root node.
 *   4. removeChild removes the component from the TuiEngine's root node.
 *   5. The new engine path renders component content to the terminal.
 *
 * Each test sets/restores PI_USE_NEW_TUI_ENGINE via withEnv so the
 * process environment is left untouched.
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import type { TuiElement } from "../src/dom/tree.ts";
import { TuiEngine } from "../src/engine.ts";
import { type Component, TUI } from "../src/tui.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

// --
// Helpers

/** Set/clear env vars around an async test function, restoring originals on exit. */
async function withEnv<T>(updates: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
	const previousValues = new Map<string, string | undefined>();
	for (const [key, value] of Object.entries(updates)) {
		previousValues.set(key, process.env[key]);
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
	try {
		return await run();
	} finally {
		for (const [key, value] of previousValues) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
	}
}

/** Minimal Component that returns fixed lines, for testing sync/render. */
class FixedLinesComponent implements Component {
	private readonly lines: string[];
	constructor(lines: string[]) {
		this.lines = lines;
	}
	render(_width: number): string[] {
		return this.lines;
	}
	invalidate(): void {}
}

/** Shape of TUI private fields accessed in tests for assertion purposes. */
interface TuiInternals {
	useNewEngine: boolean;
	newEngine: TuiEngine | null;
	bridgeWrappers: WeakMap<Component, TuiElement>;
}

// --
// Tests

describe("TUI new engine integration", () => {
	it("default: PI_USE_NEW_TUI_ENGINE not set uses legacy render path", async () => {
		await withEnv({ PI_USE_NEW_TUI_ENGINE: undefined }, async () => {
			const terminal = new VirtualTerminal(80, 24);
			const tui = new TUI(terminal);
			const internals = tui as unknown as TuiInternals;

			assert.strictEqual(internals.useNewEngine, false, "useNewEngine should be false by default");
			assert.strictEqual(internals.newEngine, null, "newEngine should be null by default");

			// Verify the legacy render path still works.
			tui.addChild(new FixedLinesComponent(["Legacy render"]));
			tui.start();
			await terminal.waitForRender();

			const viewport = terminal.getViewport();
			assert.ok(
				viewport.join("\n").includes("Legacy render"),
				`Legacy path should render content, got: ${JSON.stringify(viewport.slice(0, 3))}`,
			);

			tui.stop();
		});
	});

	it("PI_USE_NEW_TUI_ENGINE=1 creates TuiEngine instance", async () => {
		await withEnv({ PI_USE_NEW_TUI_ENGINE: "1" }, async () => {
			const terminal = new VirtualTerminal(80, 24);
			const tui = new TUI(terminal);
			const internals = tui as unknown as TuiInternals;

			assert.strictEqual(internals.useNewEngine, true, "useNewEngine should be true when env var is 1");
			assert.ok(internals.newEngine !== null, "newEngine should be created");
			assert.ok(internals.newEngine instanceof TuiEngine, "newEngine should be a TuiEngine instance");

			tui.stop();
		});
	});

	it("syncs children to new engine root node after addChild + requestRender", async () => {
		await withEnv({ PI_USE_NEW_TUI_ENGINE: "1" }, async () => {
			const terminal = new VirtualTerminal(80, 24);
			const tui = new TUI(terminal);
			const internals = tui as unknown as TuiInternals;
			const engine = internals.newEngine;
			assert.ok(engine !== null, "engine should be created");
			const newEngine: TuiEngine = engine;

			const component = new FixedLinesComponent(["Synced child"]);
			tui.addChild(component);
			tui.requestRender();
			await terminal.waitForRender();

			const children = newEngine.rootNode.childNodes;
			assert.strictEqual(children.length, 1, "root should have exactly one child");
			assert.strictEqual(children[0]?.nodeName, "ink-legacy", "child should be an ink-legacy node");
			assert.strictEqual(children[0]?.component, component, "child component should match");

			tui.stop();
		});
	});

	it("removes child from new engine root node after removeChild + requestRender", async () => {
		await withEnv({ PI_USE_NEW_TUI_ENGINE: "1" }, async () => {
			const terminal = new VirtualTerminal(80, 24);
			const tui = new TUI(terminal);
			const internals = tui as unknown as TuiInternals;
			const engine = internals.newEngine;
			assert.ok(engine !== null, "engine should be created");
			const newEngine: TuiEngine = engine;

			const component = new FixedLinesComponent(["To be removed"]);
			tui.addChild(component);
			tui.requestRender();
			await terminal.waitForRender();

			assert.strictEqual(newEngine.rootNode.childNodes.length, 1, "child should be present after add");

			tui.removeChild(component);
			tui.requestRender();
			await terminal.waitForRender();

			assert.strictEqual(newEngine.rootNode.childNodes.length, 0, "root should have no children after removeChild");

			tui.stop();
		});
	});

	it("renders component content to terminal via new engine path", async () => {
		await withEnv({ PI_USE_NEW_TUI_ENGINE: "1" }, async () => {
			const terminal = new VirtualTerminal(80, 24);
			const tui = new TUI(terminal);

			tui.addChild(new FixedLinesComponent(["Hello New Engine"]));
			tui.start();
			await terminal.waitForRender();

			const viewport = terminal.getViewport();
			assert.ok(
				viewport.join("\n").includes("Hello New Engine"),
				`New engine path should render content, got: ${JSON.stringify(viewport.slice(0, 3))}`,
			);

			tui.stop();
		});
	});
});
