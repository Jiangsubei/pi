/**
 * Kitty image integration tests — SubTask 34.5.
 *
 * Verifies that Kitty graphics protocol sequences (`\x1b_G...`) emitted
 * by legacy {@link Component}s are:
 *   1. Preserved as raw bytes in the terminal output (not stripped by
 *      the bridge paint pass, which strips ANSI sequences it
 *      recognizes).
 *   2. Tracked across frames by {@link TuiEngine} via image IDs.
 *   3. Deleted via `deleteKittyImage` (`\x1b_Ga=d,d=I,i=<id>...`) when
 *      a previously rendered image is no longer present.
 *   4. Not re-emitted when unchanged across frames (deduplication).
 *
 * Background: the new engine's paint pass (`renderLegacy`) strips ANSI
 * sequences it recognizes (CSI/OSC/APC `ESC _`) via `extractAnsiCode`.
 * Kitty graphics use `ESC G` which `extractAnsiCode` does NOT
 * recognize, so without explicit handling the raw bytes would corrupt
 * the cell-based Screen. `renderLegacy` must detect Kitty image lines
 * before stripping, store the raw line on the node, and skip writing
 * to the Screen. `TuiEngine.renderLoop` then emits the raw sequences at
 * the correct screen positions after the diff output.
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import { flushAnimationFrames } from "../src/engine/animation.ts";
import { TuiEngine } from "../src/engine.ts";
import type { Terminal } from "../src/terminal.ts";
import type { Component } from "../src/tui.ts";

// --
// CapturingTerminal — records all writes for assertion

/**
 * Minimal {@link Terminal} implementation that records every `write`
 * call into a flat array. Used to verify raw ANSI byte output without
 * xterm.js interpreting (and potentially swallowing) Kitty graphics
 * sequences.
 */
class CapturingTerminal implements Terminal {
	private readonly _columns: number;
	private readonly _rows: number;
	readonly writes: string[] = [];

	constructor(columns = 80, rows = 24) {
		this._columns = columns;
		this._rows = rows;
	}

	start(_onInput: (data: string) => void, _onResize: () => void): void {}
	stop(): void {}
	async drainInput(): Promise<void> {}
	write(data: string): void {
		this.writes.push(data);
	}
	get columns(): number {
		return this._columns;
	}
	get rows(): number {
		return this._rows;
	}
	get kittyProtocolActive(): boolean {
		return true;
	}
	enableMouseMode(): void {}
	disableMouseMode(): void {}
	isMouseModeEnabled(): boolean {
		return false;
	}
	moveBy(): void {}
	hideCursor(): void {}
	showCursor(): void {}
	clearLine(): void {}
	clearFromCursor(): void {}
	clearScreen(): void {}
	setTitle(): void {}
	setProgress(): void {}
}

// --
// Kitty image test component

/**
 * A legacy {@link Component} that renders a Kitty graphics image line.
 * When `imageId` is set, `render()` returns a single line containing
 * the Kitty APC sequence with that ID. When `imageId` is null, returns
 * an empty array (no image).
 *
 * The sequence format matches {@link encodeKitty}:
 * `ESC G a=T,f=100,q=2,i=<id>,c=10,r=1;<data> ESC \`
 */
class KittyImageComponent implements Component {
	private currentImageId: number | null;
	readonly rows: number;

	constructor(imageId: number | null, rows = 1) {
		this.currentImageId = imageId;
		this.rows = rows;
	}

	setImageId(id: number | null): void {
		this.currentImageId = id;
	}

	render(_width: number): string[] {
		if (this.currentImageId === null) return [];
		const seq = `\x1b_Ga=T,f=100,q=2,i=${this.currentImageId},c=10,r=${this.rows};AAAA\x1b\\`;
		return [seq];
	}

	invalidate(): void {}
}

// --
// Helpers

/** Flush the animation frame queue and return the concatenated terminal output. */
function flushAndCollect(terminal: CapturingTerminal): string {
	flushAnimationFrames();
	return terminal.writes.join("");
}

/** Flush once and return only the writes added since the previous flush. */
function flushDelta(terminal: CapturingTerminal): string {
	const prevLen = terminal.writes.length;
	flushAnimationFrames();
	return terminal.writes.slice(prevLen).join("");
}

// --
// Tests

describe("Kitty image integration (SubTask 34.5)", () => {
	describe("raw Kitty sequence emission", () => {
		it("emits raw Kitty APC sequence when a component renders an image line", () => {
			const terminal = new CapturingTerminal(80, 24);
			const engine = new TuiEngine(terminal);
			const component = new KittyImageComponent(42);
			const node = engine.wrapComponent(component);
			engine.appendChild(engine.rootNode, node);

			engine.start();
			const output = flushAndCollect(terminal);

			assert.ok(
				output.includes("\x1b_Ga=T,f=100,q=2,i=42"),
				`Expected terminal output to contain raw Kitty APC sequence with i=42, got: ${JSON.stringify(output)}`,
			);
			engine.stop();
		});

		it("does not corrupt Screen cells with raw Kitty escape bytes", () => {
			const terminal = new CapturingTerminal(80, 24);
			const engine = new TuiEngine(terminal);
			const component = new KittyImageComponent(7);
			const node = engine.wrapComponent(component);
			engine.appendChild(engine.rootNode, node);

			engine.start();
			const output = flushAndCollect(terminal);

			// The raw Kitty sequence should be emitted, but the diff
			// output (cell-based) should NOT contain the raw ESC byte
			// followed by 'G' as visible cell content. The Kitty
			// sequence must be emitted as a raw passthrough, not as
			// cells. We verify by checking that the diff portion
			// (BSU-wrapped) does not contain the Kitty params as
			// visible text.
			const bsuStart = output.indexOf("\x1b[?2026h");
			const bsuEnd = output.indexOf("\x1b[?2026l");
			assert.ok(bsuStart !== -1 && bsuEnd !== -1, "BSU guards should be present");
			const diffBody = output.slice(bsuStart, bsuEnd);
			assert.ok(
				!diffBody.includes("a=T,f=100"),
				`Kitty params should not leak into diff body as visible text, got: ${JSON.stringify(diffBody)}`,
			);
			engine.stop();
		});
	});

	describe("Kitty image ID tracking and deletion", () => {
		it("emits deleteKittyImage when a previously rendered image is removed", () => {
			const terminal = new CapturingTerminal(80, 24);
			const engine = new TuiEngine(terminal);
			const component = new KittyImageComponent(99);
			const node = engine.wrapComponent(component);
			engine.appendChild(engine.rootNode, node);

			engine.start();
			flushAndCollect(terminal);

			// Remove the image and re-render
			component.setImageId(null);
			engine.requestRender();
			const delta = flushDelta(terminal);

			assert.ok(
				delta.includes("\x1b_Ga=d,d=I,i=99"),
				`Expected deleteKittyImage sequence for i=99 after image removal, got: ${JSON.stringify(delta)}`,
			);
			engine.stop();
		});

		it("does not delete Kitty images that are still present", () => {
			const terminal = new CapturingTerminal(80, 24);
			const engine = new TuiEngine(terminal);
			const component = new KittyImageComponent(55);
			const node = engine.wrapComponent(component);
			engine.appendChild(engine.rootNode, node);

			engine.start();
			flushAndCollect(terminal);

			// Re-render without removing the image — trigger via requestRender
			engine.requestRender();
			const delta = flushDelta(terminal);

			assert.ok(
				!delta.includes("\x1b_Ga=d,d=I,i=55"),
				`Should NOT emit deleteKittyImage for i=55 when image is still present, got: ${JSON.stringify(delta)}`,
			);
			engine.stop();
		});
	});

	describe("deduplication", () => {
		it("does not re-emit the same Kitty image when unchanged across frames", () => {
			const terminal = new CapturingTerminal(80, 24);
			const engine = new TuiEngine(terminal);
			const component = new KittyImageComponent(33);
			const node = engine.wrapComponent(component);
			engine.appendChild(engine.rootNode, node);

			engine.start();
			flushAndCollect(terminal);

			// Re-render without change
			engine.requestRender();
			const delta = flushDelta(terminal);

			// The raw Kitty sequence should NOT be re-emitted (same ID, same position)
			assert.ok(
				!delta.includes("\x1b_Ga=T,f=100,q=2,i=33"),
				`Should not re-emit unchanged Kitty image i=33, got: ${JSON.stringify(delta)}`,
			);
			engine.stop();
		});

		it("emits Kitty image again when image ID changes", () => {
			const terminal = new CapturingTerminal(80, 24);
			const engine = new TuiEngine(terminal);
			const component = new KittyImageComponent(10);
			const node = engine.wrapComponent(component);
			engine.appendChild(engine.rootNode, node);

			engine.start();
			flushAndCollect(terminal);

			// Change to a different image ID
			component.setImageId(20);
			engine.requestRender();
			const delta = flushDelta(terminal);

			// Should delete the old image and emit the new one
			assert.ok(delta.includes("\x1b_Ga=d,d=I,i=10"), `Should delete old image i=10, got: ${JSON.stringify(delta)}`);
			assert.ok(
				delta.includes("\x1b_Ga=T,f=100,q=2,i=20"),
				`Should emit new image i=20, got: ${JSON.stringify(delta)}`,
			);
			engine.stop();
		});
	});
});
