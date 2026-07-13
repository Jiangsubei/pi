/**
 * Tests for Task 20: overlay and focus sync from the legacy TUI into the
 * new Yoga-backed engine.
 *
 * Verifies that:
 *   1. Overlays shown via `tui.showOverlay()` are synced into the new
 *      engine's OverlayManager and rendered to the terminal.
 *   2. Hiding an overlay via the returned handle removes it from the new
 *      engine on the next sync.
 *   3. Toggling overlay visibility via `setHidden()` syncs the hidden
 *      state to the new engine's handle.
 *   4. Focus changes (`tui.setFocus()`) sync to the new engine's
 *      FocusManager so `getActiveElement()` matches the focused
 *      component's backing DOM node.
 *   5. Clearing focus (`tui.setFocus(null)`) blurs the FocusManager.
 *
 * Each test sets PI_USE_NEW_TUI_ENGINE=1 via withEnv so the process
 * environment is left untouched.
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import type { NewOverlayHandle } from "../src/engine/overlay.ts";
import type { TuiEngine } from "../src/engine.ts";
import { type Component, type Focusable, TUI } from "../src/tui.ts";
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

/** Minimal Component that returns fixed lines. */
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

/** A Focusable component for testing focus sync. */
class FocusableComponent implements Component, Focusable {
	focused = false;
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
	overlayHandles: Map<unknown, NewOverlayHandle>;
	lastSyncedFocus: Component | null;
	focusedComponent: Component | null;
}

// --
// Tests

describe("TUI new engine overlay/focus sync", () => {
	it("syncs shown overlay into the new engine OverlayManager", async () => {
		await withEnv({ PI_USE_NEW_TUI_ENGINE: "1" }, async () => {
			const terminal = new VirtualTerminal(80, 24);
			const tui = new TUI(terminal);
			const internals = tui as unknown as TuiInternals;
			const engine = internals.newEngine;
			assert.ok(engine !== null, "engine should be created");
			const newEngine: TuiEngine = engine;

			tui.start();
			tui.showOverlay(new FixedLinesComponent(["OVERLAY-CONTENT"]), { anchor: "top-left", width: 20 });
			await terminal.waitForRender();

			// The overlay handle should be tracked in overlayHandles.
			assert.strictEqual(internals.overlayHandles.size, 1, "one overlay handle should exist");

			// The overlay node should be a child of the engine's root.
			const overlayChildren = newEngine.rootNode.childNodes.filter((n) => n.nodeName === "ink-legacy");
			assert.ok(overlayChildren.length >= 1, "engine root should have at least one ink-legacy child");

			// The overlay content should be visible in the terminal.
			const viewport = terminal.getViewport();
			assert.ok(
				viewport.join("\n").includes("OVERLAY-CONTENT"),
				`Expected OVERLAY-CONTENT in terminal, got: ${JSON.stringify(viewport.slice(0, 3))}`,
			);

			tui.stop();
		});
	});

	it("removes overlay from new engine after handle.hide()", async () => {
		await withEnv({ PI_USE_NEW_TUI_ENGINE: "1" }, async () => {
			const terminal = new VirtualTerminal(80, 24);
			const tui = new TUI(terminal);
			const internals = tui as unknown as TuiInternals;

			tui.start();
			const handle = tui.showOverlay(new FixedLinesComponent(["HIDE-ME"]), {
				anchor: "top-left",
				width: 10,
			});
			await terminal.waitForRender();
			assert.strictEqual(internals.overlayHandles.size, 1, "overlay should be present before hide");

			handle.hide();
			tui.requestRender();
			await terminal.waitForRender();

			assert.strictEqual(internals.overlayHandles.size, 0, "overlay handle should be removed after hide");

			const viewport = terminal.getViewport();
			assert.ok(
				!viewport.join("\n").includes("HIDE-ME"),
				`HIDE-ME should not be visible after hide, got: ${JSON.stringify(viewport.slice(0, 3))}`,
			);

			tui.stop();
		});
	});

	it("syncs hidden state via setHidden()", async () => {
		await withEnv({ PI_USE_NEW_TUI_ENGINE: "1" }, async () => {
			const terminal = new VirtualTerminal(80, 24);
			const tui = new TUI(terminal);
			const internals = tui as unknown as TuiInternals;

			tui.start();
			const handle = tui.showOverlay(new FixedLinesComponent(["TOGGLE-SYNC"]), {
				anchor: "top-left",
				width: 15,
			});
			await terminal.waitForRender();

			// Initially visible.
			const [handleValue] = [...internals.overlayHandles.values()];
			assert.ok(handleValue !== undefined, "handle should exist");
			assert.strictEqual(handleValue.isHidden(), false, "overlay should start visible");

			// Hide via the legacy handle.
			handle.setHidden(true);
			tui.requestRender();
			await terminal.waitForRender();

			assert.strictEqual(handleValue.isHidden(), true, "new engine handle should be hidden after setHidden(true)");

			// Show again.
			handle.setHidden(false);
			tui.requestRender();
			await terminal.waitForRender();
			assert.strictEqual(
				handleValue.isHidden(),
				false,
				"new engine handle should be visible after setHidden(false)",
			);

			tui.stop();
		});
	});

	it("syncs focus to FocusManager when setFocus targets a direct child", async () => {
		await withEnv({ PI_USE_NEW_TUI_ENGINE: "1" }, async () => {
			const terminal = new VirtualTerminal(80, 24);
			const tui = new TUI(terminal);
			const internals = tui as unknown as TuiInternals;
			const engine = internals.newEngine;
			assert.ok(engine !== null, "engine should be created");
			const newEngine: TuiEngine = engine;

			const component = new FocusableComponent(["FOCUSED-CHILD"]);
			tui.addChild(component);
			tui.start();
			await terminal.waitForRender();

			// Initially no focus synced.
			assert.strictEqual(internals.lastSyncedFocus, null, "lastSyncedFocus should start null");
			assert.strictEqual(newEngine.getFocusManager().getActiveElement(), undefined, "no active element initially");

			// Focus the direct child.
			tui.setFocus(component);
			tui.requestRender();
			await terminal.waitForRender();

			const active = newEngine.getFocusManager().getActiveElement();
			assert.ok(active !== undefined, "FocusManager should have an active element after setFocus");
			assert.strictEqual(active?.component, component, "active element's component should match the focused child");
			assert.strictEqual(internals.lastSyncedFocus, component, "lastSyncedFocus should track the focused component");
			assert.strictEqual(component.focused, true, "component.focused should be true");

			// Clear focus.
			tui.setFocus(null);
			tui.requestRender();
			await terminal.waitForRender();

			assert.strictEqual(
				newEngine.getFocusManager().getActiveElement(),
				undefined,
				"active element should be cleared",
			);
			assert.strictEqual(internals.lastSyncedFocus, null, "lastSyncedFocus should be null after clearing");
			assert.strictEqual(component.focused, false, "component.focused should be false after blur");

			tui.stop();
		});
	});

	it("syncs focus to FocusManager when focus targets an overlay component", async () => {
		await withEnv({ PI_USE_NEW_TUI_ENGINE: "1" }, async () => {
			const terminal = new VirtualTerminal(80, 24);
			const tui = new TUI(terminal);
			const internals = tui as unknown as TuiInternals;
			const engine = internals.newEngine;
			assert.ok(engine !== null, "engine should be created");
			const newEngine: TuiEngine = engine;

			const overlayComp = new FocusableComponent(["OVERLAY-FOCUSED"]);
			tui.start();
			tui.showOverlay(overlayComp, { anchor: "top-left", width: 20 });
			await terminal.waitForRender();

			// showOverlay with a capturing overlay calls setFocus internally.
			const active = newEngine.getFocusManager().getActiveElement();
			assert.ok(active !== undefined, "FocusManager should have an active element after overlay show");
			assert.strictEqual(active?.component, overlayComp, "active element should be the overlay component");
			assert.strictEqual(overlayComp.focused, true, "overlay component should be focused");

			tui.stop();
		});
	});

	it("does not re-sync focus when focusedComponent is unchanged", async () => {
		await withEnv({ PI_USE_NEW_TUI_ENGINE: "1" }, async () => {
			const terminal = new VirtualTerminal(80, 24);
			const tui = new TUI(terminal);
			const internals = tui as unknown as TuiInternals;

			const component = new FocusableComponent(["STABLE-FOCUS"]);
			tui.addChild(component);
			tui.start();
			tui.setFocus(component);
			tui.requestRender();
			await terminal.waitForRender();

			assert.strictEqual(internals.lastSyncedFocus, component, "focus should be synced on first render");

			// Trigger another render without changing focus.
			tui.requestRender();
			await terminal.waitForRender();

			// lastSyncedFocus should still be the same component (no re-sync needed).
			assert.strictEqual(internals.lastSyncedFocus, component, "focus should not be re-synced");

			tui.stop();
		});
	});
});
