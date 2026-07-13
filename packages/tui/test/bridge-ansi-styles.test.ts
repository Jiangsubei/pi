/**
 * Verification tests for ANSI SGR → TextStyles conversion in the bridge.
 *
 * These tests verify that {@link renderLegacy} now preserves component-
 * emitted SGR styling (colors, bold, italic, etc.) by interning each
 * styled segment's {@link TextStyles} via the {@link StylePool} and
 * writing it with a per-segment `styleId`, instead of stripping all
 * ANSI and writing plain text with only the inherited style.
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import { wrapComponent } from "../src/bridge/adapter.ts";
import { appendChild, createNode, type TuiElement } from "../src/dom/tree.ts";
import { Output } from "../src/output/output.ts";
import { renderNode } from "../src/output/render-node.ts";
import { Screen } from "../src/screen/screen.ts";
import { type Component, TUI } from "../src/tui.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

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

describe("bridge: ANSI SGR → TextStyles conversion", () => {
	it("16-color foreground (\\x1b[31m) is preserved as ansi:red", () => {
		const component = new FixedLines(["\x1b[31mRed\x1b[0m"]);
		const node = wrapComponent(component);
		const root = createNode("ink-root", { flexDirection: "column", width: "100%", height: "100%" });
		appendChild(root, node);
		const screen = paintTree(root, 80, 24);
		const cell = screen.getCell(0, 0);
		assert.strictEqual(cell.char, "R", `first cell should be 'R', got '${cell.char}'`);
		const style = screen.stylePool.get(cell.styleId);
		assert.strictEqual(style?.color, "ansi:red", `color should be ansi:red, got ${JSON.stringify(style)}`);
	});

	it("bright foreground (\\x1b[91m) is preserved as ansi:redBright", () => {
		const component = new FixedLines(["\x1b[91mBrightRed\x1b[0m"]);
		const node = wrapComponent(component);
		const root = createNode("ink-root", { flexDirection: "column", width: "100%", height: "100%" });
		appendChild(root, node);
		const screen = paintTree(root, 80, 24);
		const cell = screen.getCell(0, 0);
		const style = screen.stylePool.get(cell.styleId);
		assert.strictEqual(style?.color, "ansi:redBright", `color should be ansi:redBright`);
	});

	it("256-color foreground (\\x1b[38;5;208m) is preserved as ansi256(208)", () => {
		const component = new FixedLines(["\x1b[38;5;208mOrange\x1b[0m"]);
		const node = wrapComponent(component);
		const root = createNode("ink-root", { flexDirection: "column", width: "100%", height: "100%" });
		appendChild(root, node);
		const screen = paintTree(root, 80, 24);
		const cell = screen.getCell(0, 0);
		const style = screen.stylePool.get(cell.styleId);
		assert.strictEqual(style?.color, "ansi256(208)", `color should be ansi256(208)`);
	});

	it("RGB foreground (\\x1b[38;2;255;0;128m) is preserved as rgb(255,0,128)", () => {
		const component = new FixedLines(["\x1b[38;2;255;0;128mPink\x1b[0m"]);
		const node = wrapComponent(component);
		const root = createNode("ink-root", { flexDirection: "column", width: "100%", height: "100%" });
		appendChild(root, node);
		const screen = paintTree(root, 80, 24);
		const cell = screen.getCell(0, 0);
		const style = screen.stylePool.get(cell.styleId);
		assert.strictEqual(style?.color, "rgb(255,0,128)", `color should be rgb(255,0,128)`);
	});

	it("background color (\\x1b[42m) is preserved as ansi:green", () => {
		const component = new FixedLines(["\x1b[42mBg\x1b[0m"]);
		const node = wrapComponent(component);
		const root = createNode("ink-root", { flexDirection: "column", width: "100%", height: "100%" });
		appendChild(root, node);
		const screen = paintTree(root, 80, 24);
		const cell = screen.getCell(0, 0);
		const style = screen.stylePool.get(cell.styleId);
		assert.strictEqual(style?.backgroundColor, "ansi:green", `backgroundColor should be ansi:green`);
	});

	it("bold (\\x1b[1m) is preserved", () => {
		const component = new FixedLines(["\x1b[1mBold\x1b[0m"]);
		const node = wrapComponent(component);
		const root = createNode("ink-root", { flexDirection: "column", width: "100%", height: "100%" });
		appendChild(root, node);
		const screen = paintTree(root, 80, 24);
		const cell = screen.getCell(0, 0);
		const style = screen.stylePool.get(cell.styleId);
		assert.strictEqual(style?.bold, true, `bold should be true`);
	});

	it("italic (\\x1b[3m) is preserved", () => {
		const component = new FixedLines(["\x1b[3mItalic\x1b[0m"]);
		const node = wrapComponent(component);
		const root = createNode("ink-root", { flexDirection: "column", width: "100%", height: "100%" });
		appendChild(root, node);
		const screen = paintTree(root, 80, 24);
		const cell = screen.getCell(0, 0);
		const style = screen.stylePool.get(cell.styleId);
		assert.strictEqual(style?.italic, true, `italic should be true`);
	});

	it("underline (\\x1b[4m) is preserved", () => {
		const component = new FixedLines(["\x1b[4mUnder\x1b[0m"]);
		const node = wrapComponent(component);
		const root = createNode("ink-root", { flexDirection: "column", width: "100%", height: "100%" });
		appendChild(root, node);
		const screen = paintTree(root, 80, 24);
		const cell = screen.getCell(0, 0);
		const style = screen.stylePool.get(cell.styleId);
		assert.strictEqual(style?.underline, true, `underline should be true`);
	});

	it("inverse (\\x1b[7m) is preserved", () => {
		const component = new FixedLines(["\x1b[7mInv\x1b[0m"]);
		const node = wrapComponent(component);
		const root = createNode("ink-root", { flexDirection: "column", width: "100%", height: "100%" });
		appendChild(root, node);
		const screen = paintTree(root, 80, 24);
		const cell = screen.getCell(0, 0);
		const style = screen.stylePool.get(cell.styleId);
		assert.strictEqual(style?.inverse, true, `inverse should be true`);
	});

	it("strikethrough (\\x1b[9m) is preserved", () => {
		const component = new FixedLines(["\x1b[9mStrike\x1b[0m"]);
		const node = wrapComponent(component);
		const root = createNode("ink-root", { flexDirection: "column", width: "100%", height: "100%" });
		appendChild(root, node);
		const screen = paintTree(root, 80, 24);
		const cell = screen.getCell(0, 0);
		const style = screen.stylePool.get(cell.styleId);
		assert.strictEqual(style?.strikethrough, true, `strikethrough should be true`);
	});

	it("multiple SGR runs produce distinct styleIds", () => {
		// "Red" (red) + "Plain" (default) on one line.
		const component = new FixedLines(["\x1b[31mRed\x1b[0mPlain"]);
		const node = wrapComponent(component);
		const root = createNode("ink-root", { flexDirection: "column", width: "100%", height: "100%" });
		appendChild(root, node);
		const screen = paintTree(root, 80, 24);
		const redCell = screen.getCell(0, 0);
		const plainCell = screen.getCell(3, 0);
		assert.notStrictEqual(redCell.styleId, plainCell.styleId, "Red and Plain should have different styleIds");
		const redStyle = screen.stylePool.get(redCell.styleId);
		assert.strictEqual(redStyle?.color, "ansi:red", "first segment should be red");
		const plainStyle = screen.stylePool.get(plainCell.styleId);
		assert.strictEqual(plainStyle?.color, undefined, "second segment should have no color (after reset)");
	});

	it("reset (\\x1b[0m) clears component-set attributes", () => {
		// Bold then reset → after reset, bold should be false (not undefined).
		const component = new FixedLines(["\x1b[1mBold\x1b[0m Plain"]);
		const node = wrapComponent(component);
		const root = createNode("ink-root", { flexDirection: "column", width: "100%", height: "100%" });
		appendChild(root, node);
		const screen = paintTree(root, 80, 24);
		const plainCell = screen.getCell(5, 0); // "Plain" starts at col 5
		const plainStyle = screen.stylePool.get(plainCell.styleId);
		assert.strictEqual(
			plainStyle?.bold,
			false,
			`bold should be false after reset, got ${JSON.stringify(plainStyle)}`,
		);
	});
});

describe("bridge: wrapComponent default flexShrink", () => {
	it("defaults to flexShrink: 0 and keeps the bottom of the layout visible", async () => {
		await withEnv({ PI_USE_NEW_TUI_ENGINE: "1" }, async () => {
			const terminal = new VirtualTerminal(80, 24);
			const tui = new TUI(terminal);

			// 50 lines of chat content + editor + footer. The legacy TUI
			// renders components at their natural height and relies on the
			// bottom of the layout staying visible (like terminal scrollback).
			const chat = new FixedLines(Array.from({ length: 50 }, (_, i) => `msg ${i}`));
			const editor = new FixedLines(["> editor"]);
			const footer = new FixedLines(["[footer]"]);

			tui.addChild(chat);
			tui.addChild(editor);
			tui.addChild(footer);
			tui.start();
			await terminal.waitForRender();

			const viewport = terminal.getViewport();
			const joined = viewport.join("\n");
			// With flexShrink: 0 the renderer paints at natural height and
			// shifts the viewport down so the latest content (editor +
			// footer) stays visible while the oldest chat messages are
			// pushed above the viewport.
			assert.ok(joined.includes("> editor"), `editor should be visible, got:\n${joined}`);
			assert.ok(joined.includes("[footer]"), `footer should be visible, got:\n${joined}`);
			// Latest chat messages should be visible near the bottom.
			assert.ok(joined.includes("msg 49"), `latest chat message should be visible, got:\n${joined}`);
			// Oldest messages should be clipped.
			assert.ok(!joined.includes("msg 0"), `oldest chat message should be clipped, got:\n${joined}`);

			tui.stop();
		});
	});

	it("flexShrink: 1 can be explicitly set to compress a section", async () => {
		await withEnv({ PI_USE_NEW_TUI_ENGINE: "1" }, async () => {
			const terminal = new VirtualTerminal(80, 24);
			const tui = new TUI(terminal);

			const chat = new FixedLines(Array.from({ length: 50 }, (_, i) => `msg ${i}`));
			const editor = new FixedLines(["> editor"]);
			tui.addChild(chat);
			tui.addChild(editor);

			tui.start();
			await terminal.waitForRender();

			// Override flexShrink to 1 on the chat wrapper so it absorbs
			// overflow, compressing the chat region instead of scrolling it.
			const internals = tui as unknown as {
				bridgeWrappers: Map<Component, TuiElement>;
			};
			const chatWrapper = internals.bridgeWrappers.get(chat);
			assert.ok(chatWrapper !== undefined, "chat wrapper should exist");
			chatWrapper!.yogaNode.setFlexShrink(1);
			tui.requestRender(true);
			await terminal.waitForRender();

			const viewport = terminal.getViewport();
			const joined = viewport.join("\n");
			// With flexShrink: 1 on chat, the editor stays visible and the
			// chat is compressed to fit.
			assert.ok(joined.includes("> editor"), `editor should be visible, got:\n${joined}`);
			const msgCount = joined.split("\n").filter((l) => l.startsWith("msg ")).length;
			assert.ok(msgCount < 50, `chat should be compressed (< 50 lines), got ${msgCount}`);

			tui.stop();
		});
	});
});
