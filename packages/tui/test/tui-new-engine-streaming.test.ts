/**
 * End-to-end test: simulate the production streaming flow (agent reply
 * messages + tool calls) through the full TUI + syncChildrenToEngine +
 * TuiEngine path.
 *
 * This test verifies that:
 *   1. A Container's internal children changes (addChild) are reflected
 *      on screen after requestRender + render.
 *   2. Content updates to an existing child (streaming update) are
 *      reflected.
 *   3. Multiple siblings (message + tool call) are both visible.
 *   4. A child that initially returned [] (empty render) and later
 *      returns content is correctly re-measured and shown.
 *
 * This mirrors the real interactive-mode flow:
 *   chatContainer.addChild(streamingComponent)
 *   chatContainer.addChild(toolExecutionComponent)
 *   streamingComponent.updateContent(...)
 *   ui.requestRender()
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import { type Component, Container, TUI } from "../src/tui.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

// --
// Helpers

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

/** A component that returns mutable lines (simulates streaming content). */
class MutableLines implements Component {
	private lines: string[];
	constructor(lines: string[] = []) {
		this.lines = lines;
	}
	setLines(lines: string[]): void {
		this.lines = lines;
	}
	render(_width: number): string[] {
		return this.lines;
	}
	invalidate(): void {}
}

// --
// Tests

describe("TUI new engine: streaming message + tool call rendering", () => {
	it("shows content appended to a Container after requestRender", async () => {
		await withEnv({ PI_USE_NEW_TUI_ENGINE: "1" }, async () => {
			const terminal = new VirtualTerminal(80, 24);
			const tui = new TUI(terminal);
			tui.start();

			// Simulate chatContainer with one message.
			const chatContainer = new Container();
			const msg1 = new MutableLines(["Hello from agent"]);
			chatContainer.addChild(msg1);
			tui.addChild(chatContainer);

			tui.requestRender();
			await terminal.waitForRender();

			const viewport1 = terminal.getViewport();
			assert.ok(
				viewport1.join("\n").includes("Hello from agent"),
				`First message should be visible, got: ${JSON.stringify(viewport1.slice(0, 3))}`,
			);

			// Simulate a new message being appended (tool call).
			const tool1 = new MutableLines(["Running tool: edit"]);
			chatContainer.addChild(tool1);

			tui.requestRender();
			await terminal.waitForRender();

			const viewport2 = terminal.getViewport();
			assert.ok(
				viewport2.join("\n").includes("Running tool: edit"),
				`Tool call should be visible after append, got: ${JSON.stringify(viewport2.slice(0, 5))}`,
			);
			assert.ok(
				viewport2.join("\n").includes("Hello from agent"),
				`First message should still be visible, got: ${JSON.stringify(viewport2.slice(0, 5))}`,
			);

			tui.stop();
		});
	});

	it("shows updated content when a streaming component changes", async () => {
		await withEnv({ PI_USE_NEW_TUI_ENGINE: "1" }, async () => {
			const terminal = new VirtualTerminal(80, 24);
			const tui = new TUI(terminal);
			tui.start();

			const chatContainer = new Container();
			const msg = new MutableLines(["Partial response..."]);
			chatContainer.addChild(msg);
			tui.addChild(chatContainer);

			tui.requestRender();
			await terminal.waitForRender();

			const viewport1 = terminal.getViewport();
			assert.ok(
				viewport1.join("\n").includes("Partial response..."),
				`Initial content should be visible, got: ${JSON.stringify(viewport1.slice(0, 3))}`,
			);

			// Simulate streaming update: content changes.
			msg.setLines(["Full response with more detail"]);

			tui.requestRender();
			await terminal.waitForRender();

			const viewport2 = terminal.getViewport();
			assert.ok(
				viewport2.join("\n").includes("Full response with more detail"),
				`Updated content should be visible, got: ${JSON.stringify(viewport2.slice(0, 3))}`,
			);

			tui.stop();
		});
	});

	it("shows a child that initially returned empty and later has content", async () => {
		await withEnv({ PI_USE_NEW_TUI_ENGINE: "1" }, async () => {
			const terminal = new VirtualTerminal(80, 24);
			const tui = new TUI(terminal);
			tui.start();

			const chatContainer = new Container();
			// Start with an empty component (simulates AssistantMessageComponent
			// created before any content arrives).
			const msg = new MutableLines([]);
			chatContainer.addChild(msg);
			tui.addChild(chatContainer);

			tui.requestRender();
			await terminal.waitForRender();

			// Now content arrives.
			msg.setLines(["Agent reply arrived"]);

			tui.requestRender();
			await terminal.waitForRender();

			const viewport = terminal.getViewport();
			assert.ok(
				viewport.join("\n").includes("Agent reply arrived"),
				`Content should be visible after transitioning from empty to non-empty, got: ${JSON.stringify(viewport.slice(0, 5))}`,
			);

			tui.stop();
		});
	});

	it("renders multiple siblings with a tall editor competing for space", async () => {
		await withEnv({ PI_USE_NEW_TUI_ENGINE: "1" }, async () => {
			const terminal = new VirtualTerminal(80, 24);
			const tui = new TUI(terminal);
			tui.start();

			// Simulate the full interactive-mode layout:
			// header (1 line) + chat (variable) + status (1 line) + editor (5 lines) + footer (1 line)
			const header = new MutableLines(["== Header =="]);
			const chatContainer = new Container();
			const status = new MutableLines(["[status]"]);
			const editor = new MutableLines([
				"editor line 1",
				"editor line 2",
				"editor line 3",
				"editor line 4",
				"editor line 5",
			]);
			const footer = new MutableLines(["-- footer --"]);

			tui.addChild(header);
			tui.addChild(chatContainer);
			tui.addChild(status);
			tui.addChild(editor);
			tui.addChild(footer);

			// Add several messages.
			chatContainer.addChild(new MutableLines(["Message 1"]));
			chatContainer.addChild(new MutableLines(["Message 2"]));
			chatContainer.addChild(new MutableLines(["Tool call: edit file.ts"]));

			tui.requestRender();
			await terminal.waitForRender();

			const viewport = terminal.getViewport();
			const allContent = viewport.join("\n");

			// Even with flex compression, at least the first message should be visible.
			assert.ok(
				allContent.includes("Message 1"),
				`Message 1 should be visible even with competing siblings, got:\n${allContent}`,
			);
			assert.ok(allContent.includes("Tool call: edit file.ts"), `Tool call should be visible, got:\n${allContent}`);
			assert.ok(allContent.includes("-- footer --"), `Footer should be visible, got:\n${allContent}`);

			tui.stop();
		});
	});
});
