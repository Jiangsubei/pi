/**
 * P2 integration tests — Overlay system on the new Yoga-backed engine.
 *
 * Verifies that {@link TuiEngine.showOverlay} positions overlays correctly
 * via `position: absolute` styles, that the returned {@link NewOverlayHandle}
 * controls visibility/focus, and that z-order falls out of DOM child order.
 *
 * The legacy `TUI.showOverlay` is covered by `overlay-options.test.ts`; this
 * file exercises the parallel `OverlayManager` implementation in
 * `engine/overlay.ts` which uses Yoga layout instead of manual compositing.
 *
 * Each test follows the same pattern:
 * 1. Create a {@link VirtualTerminal} + {@link TuiEngine}.
 * 2. Optionally append a base content node so the root is non-empty.
 * 3. `engine.showOverlay(component, options)` → handle.
 * 4. Start engine, wait for render, assert position/visibility/focus.
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import { TuiEngine } from "../src/engine.ts";
import type { Component } from "../src/tui.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

// --
// Helpers

/**
 * Minimal component that renders fixed lines. Used as overlay content so
 * tests can assert specific strings appear at specific positions.
 */
class StaticOverlay implements Component {
	private lines: string[];

	constructor(lines: string[]) {
		this.lines = lines;
	}

	render(): string[] {
		return this.lines;
	}

	invalidate(): void {}
}

/** Minimal component rendering nothing — used as base content under overlays. */
class EmptyContent implements Component {
	render(): string[] {
		return [];
	}
	invalidate(): void {}
}

/**
 * Create a started VirtualTerminal + TuiEngine pair.
 * Returns both so the test can stop them in cleanup.
 */
function createEngine(cols = 80, rows = 24): { terminal: VirtualTerminal; engine: TuiEngine } {
	const terminal = new VirtualTerminal(cols, rows);
	terminal.start(
		() => undefined,
		() => undefined,
	);
	const engine = new TuiEngine(terminal);
	return { terminal, engine };
}

/** Assert that `needle` appears somewhere in the terminal viewport. */
function assertInViewport(terminal: VirtualTerminal, needle: string, message?: string): void {
	const viewport = terminal.getViewport();
	assert.ok(
		viewport.join("\n").includes(needle),
		`${message ?? "assertion failed"}: expected "${needle}" in terminal, got: ${JSON.stringify(viewport.slice(0, 5))}`,
	);
}

/** Assert that `needle` does NOT appear in the terminal viewport. */
function assertNotInViewport(terminal: VirtualTerminal, needle: string, message?: string): void {
	const viewport = terminal.getViewport();
	assert.ok(
		!viewport.join("\n").includes(needle),
		`${message ?? "assertion failed"}: did not expect "${needle}" in terminal, got: ${JSON.stringify(viewport.slice(0, 5))}`,
	);
}

// --
// Tests

describe("overlay-new-engine: Overlay system on TuiEngine", () => {
	it("shows overlay at center anchor", async () => {
		const { terminal, engine } = createEngine();
		try {
			engine.appendChild(engine.rootNode, engine.wrapComponent(new EmptyContent()));
			engine.showOverlay(new StaticOverlay(["CENTERED"]), { anchor: "center", width: 10 });

			engine.start();
			await terminal.waitForRender();

			const viewport = terminal.getViewport();
			// Centered vertically in 24 rows: overlay height 1 → row ~11.
			// Centered horizontally in 80 cols: width 10 → col ~35.
			let foundRow = -1;
			for (let i = 0; i < viewport.length; i++) {
				if (viewport[i]?.includes("CENTERED")) {
					foundRow = i;
					break;
				}
			}
			assert.ok(foundRow >= 8 && foundRow <= 15, `Expected CENTERED near vertical center, got row ${foundRow}`);
			const colIndex = viewport[foundRow]?.indexOf("CENTERED") ?? -1;
			assert.ok(colIndex >= 30 && colIndex <= 40, `Expected CENTERED near horizontal center, got col ${colIndex}`);
		} finally {
			engine.stop();
			terminal.stop();
		}
	});

	it("shows overlay at top-left anchor", async () => {
		const { terminal, engine } = createEngine();
		try {
			engine.appendChild(engine.rootNode, engine.wrapComponent(new EmptyContent()));
			engine.showOverlay(new StaticOverlay(["TOP-LEFT"]), { anchor: "top-left", width: 10 });

			engine.start();
			await terminal.waitForRender();

			const viewport = terminal.getViewport();
			assert.ok(viewport[0]?.startsWith("TOP-LEFT"), `Expected TOP-LEFT at row 0 col 0, got: ${viewport[0]}`);
		} finally {
			engine.stop();
			terminal.stop();
		}
	});

	it("shows overlay at bottom-right anchor", async () => {
		const { terminal, engine } = createEngine();
		try {
			engine.appendChild(engine.rootNode, engine.wrapComponent(new EmptyContent()));
			engine.showOverlay(new StaticOverlay(["BTM-RIGHT"]), { anchor: "bottom-right", width: 10 });

			engine.start();
			await terminal.waitForRender();

			const viewport = terminal.getViewport();
			const lastRow = viewport[23];
			assert.ok(lastRow?.includes("BTM-RIGHT"), `Expected BTM-RIGHT on last row, got: ${lastRow}`);
			assert.ok(lastRow?.trimEnd().endsWith("BTM-RIGHT"), `Expected BTM-RIGHT at end of last row, got: ${lastRow}`);
		} finally {
			engine.stop();
			terminal.stop();
		}
	});

	it("hides overlay via handle.hide()", async () => {
		const { terminal, engine } = createEngine();
		try {
			engine.appendChild(engine.rootNode, engine.wrapComponent(new EmptyContent()));
			const handle = engine.showOverlay(new StaticOverlay(["HIDE-ME"]), { anchor: "top-left", width: 10 });

			engine.start();
			await terminal.waitForRender();
			assertInViewport(terminal, "HIDE-ME", "overlay should be visible before hide");

			// OverlayManager.handle methods do not auto-schedule renders (by
			// design — the caller drives the render loop). Trigger one explicitly.
			handle.hide();
			engine.requestRender();
			await terminal.waitForRender();
			assertNotInViewport(terminal, "HIDE-ME", "overlay should be gone after hide");
		} finally {
			engine.stop();
			terminal.stop();
		}
	});

	it("toggles overlay visibility with setHidden/isHidden", async () => {
		const { terminal, engine } = createEngine();
		try {
			engine.appendChild(engine.rootNode, engine.wrapComponent(new EmptyContent()));
			const handle = engine.showOverlay(new StaticOverlay(["TOGGLE"]), { anchor: "top-left", width: 10 });

			engine.start();
			await terminal.waitForRender();
			assert.strictEqual(handle.isHidden(), false, "overlay should start visible");
			assertInViewport(terminal, "TOGGLE", "overlay should be visible initially");

			handle.setHidden(true);
			engine.requestRender();
			await terminal.waitForRender();
			assert.strictEqual(handle.isHidden(), true, "overlay should be hidden after setHidden(true)");
			assertNotInViewport(terminal, "TOGGLE", "overlay should be hidden after setHidden(true)");

			handle.setHidden(false);
			engine.requestRender();
			await terminal.waitForRender();
			assert.strictEqual(handle.isHidden(), false, "overlay should be visible after setHidden(false)");
			assertInViewport(terminal, "TOGGLE", "overlay should be visible again after setHidden(false)");
		} finally {
			engine.stop();
			terminal.stop();
		}
	});

	it("focuses overlay via handle.focus()", async () => {
		const { terminal, engine } = createEngine();
		try {
			engine.appendChild(engine.rootNode, engine.wrapComponent(new EmptyContent()));
			const handle = engine.showOverlay(new StaticOverlay(["FOCUS"]), { anchor: "top-left", width: 10 });

			engine.start();
			await terminal.waitForRender();
			// New nonCapturing overlay becomes focused on show.
			assert.strictEqual(handle.isFocused(), true, "overlay should be focused on show");

			handle.unfocus();
			await terminal.waitForRender();
			assert.strictEqual(handle.isFocused(), false, "overlay should not be focused after unfocus");

			handle.focus();
			await terminal.waitForRender();
			assert.strictEqual(handle.isFocused(), true, "overlay should be focused after focus()");
		} finally {
			engine.stop();
			terminal.stop();
		}
	});

	it("unfocuses overlay via handle.unfocus()", async () => {
		const { terminal, engine } = createEngine();
		try {
			engine.appendChild(engine.rootNode, engine.wrapComponent(new EmptyContent()));
			const handle = engine.showOverlay(new StaticOverlay(["UNFOCUS"]), { anchor: "top-left", width: 10 });

			engine.start();
			await terminal.waitForRender();
			assert.strictEqual(handle.isFocused(), true, "overlay should start focused");

			handle.unfocus();
			await terminal.waitForRender();
			assert.strictEqual(handle.isFocused(), false, "overlay should be unfocused");
		} finally {
			engine.stop();
			terminal.stop();
		}
	});

	it("z-order: later overlay paints on top of earlier", async () => {
		const { terminal, engine } = createEngine();
		try {
			engine.appendChild(engine.rootNode, engine.wrapComponent(new EmptyContent()));
			// First overlay at top-left, width 20 — content "FIRST-OVERLAY".
			engine.showOverlay(new StaticOverlay(["FIRST-OVERLAY"]), { anchor: "top-left", width: 20 });
			// Second overlay at top-left, width 10 — content "SECOND".
			// Same position, smaller width, appended later → paints on top.
			engine.showOverlay(new StaticOverlay(["SECOND"]), { anchor: "top-left", width: 10 });

			engine.start();
			await terminal.waitForRender();

			const viewport = terminal.getViewport();
			// SECOND should be visible at row 0 col 0 (on top of FIRST).
			assert.ok(viewport[0]?.startsWith("SECOND"), `Expected SECOND on top at row 0, got: ${viewport[0]}`);
		} finally {
			engine.stop();
			terminal.stop();
		}
	});
});
