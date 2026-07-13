/**
 * TUI new-engine scroll-box bridge tests.
 *
 * Validates that legacy Components can be hosted inside an
 * ink-scroll-box via TUI.createScrollBoxForComponent, that the
 * scroll-box participates in layout and auto-follows new children,
 * and that the mouse wheel scrolls the box without requiring an
 * explicit listener.
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import { Container, Text, TUI } from "../src/index.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

export async function withEnv<T>(updates: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
	const previous: Record<string, string | undefined> = {};
	for (const key of Object.keys(updates)) {
		previous[key] = process.env[key];
		if (updates[key] === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = updates[key];
		}
	}
	try {
		return await run();
	} finally {
		for (const key of Object.keys(previous)) {
			if (previous[key] === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = previous[key];
			}
		}
	}
}

describe("TUI new engine: createScrollBoxForComponent", () => {
	it("hosts a legacy component inside an ink-scroll-box", async () => {
		await withEnv({ PI_USE_NEW_TUI_ENGINE: "1" }, async () => {
			const terminal = new VirtualTerminal(20, 8);
			const tui = new TUI(terminal);
			tui.start();

			const chat = new Container();
			const handle = tui.createScrollBoxForComponent(chat);
			assert.ok(handle !== undefined, "createScrollBoxForComponent should return a handle in new engine");

			chat.addChild(new Text("first", 0, 0));
			chat.addChild(new Text("second", 0, 0));

			const footer = new Text("footer", 0, 0);
			tui.addChild(footer);

			tui.requestRender();
			await terminal.waitForRender();

			const viewport = terminal.getViewport();
			const joined = viewport.join("\n");
			assert.ok(joined.includes("first"), `scroll-box should render first message, got:\n${joined}`);
			assert.ok(joined.includes("second"), `scroll-box should render second message, got:\n${joined}`);
			assert.ok(joined.includes("footer"), `footer should still be visible, got:\n${joined}`);

			tui.stop();
		});
	});

	it("keeps the chat box within the viewport and auto-follows new children", async () => {
		await withEnv({ PI_USE_NEW_TUI_ENGINE: "1" }, async () => {
			const terminal = new VirtualTerminal(20, 8);
			const tui = new TUI(terminal);
			tui.start();

			const chat = new Container();
			tui.createScrollBoxForComponent(chat);
			const footer = new Text("footer", 0, 0);
			tui.addChild(footer);

			// Fill the chat container with more lines than the terminal can show.
			for (let i = 0; i < 30; i++) {
				chat.addChild(new Text(`msg ${i + 1}`, 0, 0));
			}

			tui.requestRender();
			await terminal.waitForRender();

			const viewport = terminal.getViewport();
			const joined = viewport.join("\n");
			assert.ok(joined.includes("msg 30"), `latest message should be visible, got:\n${joined}`);
			assert.ok(joined.includes("footer"), `footer should remain visible, got:\n${joined}`);
			assert.ok(!joined.includes("msg 1"), `oldest message should be clipped, got:\n${joined}`);

			tui.stop();
		});
	});

	it("auto-scrolls the box with the mouse wheel", async () => {
		await withEnv({ PI_USE_NEW_TUI_ENGINE: "1" }, async () => {
			const terminal = new VirtualTerminal(20, 8);
			const tui = new TUI(terminal);
			tui.start();

			const chat = new Container();
			tui.createScrollBoxForComponent(chat);

			for (let i = 0; i < 20; i++) {
				chat.addChild(new Text(`msg ${i + 1}`, 0, 0));
			}

			tui.requestRender();
			await terminal.waitForRender();

			// First frame: stickyScroll at the bottom — msg 13..20 visible.
			let viewport = terminal.getViewport();
			let joined = viewport.join("\n");
			assert.ok(joined.includes("msg 20"), `latest message should be visible before wheel, got:\n${joined}`);
			assert.ok(joined.includes("msg 13"), `bottom-most visible msg before wheel, got:\n${joined}`);

			// Wheel up (button 64) over the scroll-box area. Engine applies
			// deltaY * 3 = -3 rows, so scrollTop goes from 12 to 9 and the
			// view shifts to msg 10..17. Crucially msg 20 must scroll OUT of
			// view — the previous test only asserted msg 17 was visible,
			// which was already true in the bottom view (false positive).
			terminal.sendInput("\x1b[<64;3;4M");
			await terminal.waitForRender();

			viewport = terminal.getViewport();
			joined = viewport.join("\n");
			assert.ok(joined.includes("msg 10"), `older top msg should be visible after wheel up, got:\n${joined}`);
			assert.ok(joined.includes("msg 17"), `older bottom msg should be visible after wheel up, got:\n${joined}`);
			assert.ok(!joined.includes("msg 20"), `latest msg should scroll OUT after wheel up, got:\n${joined}`);
			assert.ok(!joined.includes("msg 19"), `second-latest msg should scroll OUT after wheel up, got:\n${joined}`);

			// Wheel down (button 65) — scrollBy(+3), scrollTop 9 → 12, back at bottom.
			terminal.sendInput("\x1b[<65;3;4M");
			await terminal.waitForRender();

			viewport = terminal.getViewport();
			joined = viewport.join("\n");
			assert.ok(joined.includes("msg 20"), `latest msg should be visible again after wheel down, got:\n${joined}`);
			assert.ok(joined.includes("msg 13"), `bottom-most visible msg after wheel down, got:\n${joined}`);

			tui.stop();
		});
	});

	it("is positioned correctly among sibling components", async () => {
		await withEnv({ PI_USE_NEW_TUI_ENGINE: "1" }, async () => {
			const terminal = new VirtualTerminal(80, 24);
			const tui = new TUI(terminal);
			tui.start();

			const header = new Container();
			header.addChild(new Text("[Header]", 0, 0));
			tui.addChild(header);

			const chat = new Container();
			tui.createScrollBoxForComponent(chat, { flexGrow: 1 });

			const footer = new Container();
			footer.addChild(new Text("[Footer]", 0, 0));
			tui.addChild(footer);

			for (let i = 0; i < 50; i++) {
				chat.addChild(new Text(`chat message ${i + 1}`, 0, 0));
			}

			tui.requestRender();
			await terminal.waitForRender();

			const viewport = terminal.getViewport();
			const joined = viewport.join("\n");

			assert.strictEqual(viewport[0]?.trim(), "[Header]", `header should be on the first row, got:\n${joined}`);
			assert.ok(joined.includes("[Footer]"), `footer should be visible, got:\n${joined}`);
			assert.ok(joined.includes("chat message 50"), `latest chat message should be visible, got:\n${joined}`);
			assert.ok(!joined.includes("chat message 1"), `oldest chat message should be clipped, got:\n${joined}`);

			// Header comes before the chat content; footer comes after.
			const headerIndex = joined.indexOf("[Header]");
			const lastMessageIndex = joined.indexOf("chat message 50");
			const footerIndex = joined.indexOf("[Footer]");
			assert.ok(
				headerIndex < lastMessageIndex,
				`header should appear before the latest chat message, got:\n${joined}`,
			);
			assert.ok(lastMessageIndex < footerIndex, `latest chat message should appear before footer, got:\n${joined}`);

			tui.stop();
		});
	});

	it("keeps a minimum height for the chat area even when the rest of the UI is tall", async () => {
		await withEnv({ PI_USE_NEW_TUI_ENGINE: "1" }, async () => {
			const terminal = new VirtualTerminal(80, 24);
			const tui = new TUI(terminal);
			tui.start();

			const header = new Container();
			header.addChild(new Text("[Header]", 0, 0));
			tui.addChild(header);

			const loadedResources = new Container();
			for (let i = 0; i < 20; i++) {
				loadedResources.addChild(new Text(`resource ${i + 1}`, 0, 0));
			}
			tui.addChild(loadedResources);

			const chat = new Container();
			const chatBox = tui.createScrollBoxForComponent(chat, { flexGrow: 1 });
			assert.ok(chatBox !== undefined);

			const editor = new Container();
			editor.addChild(new Text("editor line 1", 0, 0));
			editor.addChild(new Text("editor line 2", 0, 0));
			tui.addChild(editor);

			const footer = new Container();
			footer.addChild(new Text("[Footer]", 0, 0));
			tui.addChild(footer);

			for (let i = 0; i < 30; i++) {
				chat.addChild(new Text(`chat message ${i + 1}`, 0, 0));
			}

			tui.requestRender();
			await terminal.waitForRender();

			const internals = tui as unknown as {
				scrollBoxHosts: Map<Container, { scrollBox: { yogaNode: { getComputedHeight: () => number } } }>;
			};
			const host = internals.scrollBoxHosts.get(chat);
			assert.ok(host !== undefined);
			const scrollBoxHeight = host.scrollBox.yogaNode.getComputedHeight();
			assert.ok(scrollBoxHeight >= 5, `scroll-box should keep a minimum height, got ${scrollBoxHeight}`);

			const viewport = terminal.getViewport();
			const joined = viewport.join("\n");
			assert.ok(joined.includes("chat message 30"), `latest chat message should be visible, got:\n${joined}`);

			tui.stop();
		});
	});

	it("renders a waterfall container with header, resources, and chat", async () => {
		await withEnv({ PI_USE_NEW_TUI_ENGINE: "1" }, async () => {
			const terminal = new VirtualTerminal(40, 12);
			const tui = new TUI(terminal);
			tui.start();

			const header = new Container();
			header.addChild(new Text("[Header]", 0, 0));
			const resources = new Container();
			resources.addChild(new Text("[Resources]", 0, 0));
			const chat = new Container();
			for (let i = 0; i < 30; i++) {
				chat.addChild(new Text(`msg ${i + 1}`, 0, 0));
			}

			const waterfall = new Container();
			waterfall.addChild(header);
			waterfall.addChild(resources);
			waterfall.addChild(chat);
			tui.createScrollBoxForComponent(waterfall, { flexGrow: 1 });

			const editor = new Container();
			editor.addChild(new Text("> input", 0, 0));
			tui.addChild(editor);

			tui.requestRender();
			await terminal.waitForRender();

			const viewport = terminal.getViewport();
			const joined = viewport.join("\n");
			assert.ok(joined.includes("msg 30"), `latest message should be visible, got:\n${joined}`);
			assert.ok(!joined.includes("[Header]"), `header should be scrolled off, got:\n${joined}`);
			assert.ok(joined.includes("> input"), `input should remain fixed at the bottom, got:\n${joined}`);

			// Wheel up on the fixed editor area should still scroll the waterfall.
			terminal.sendInput("\x1b[<64;3;11M");
			await terminal.waitForRender();

			const scrolledViewport = terminal.getViewport();
			const scrolledJoined = scrolledViewport.join("\n");
			assert.ok(
				scrolledJoined.includes("msg 27"),
				`older messages should be visible after wheel on editor, got:\n${scrolledJoined}`,
			);

			tui.stop();
		});
	});
});
