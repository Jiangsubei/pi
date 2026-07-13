/**
 * Regression test: legacy components wrapped by the new engine must not
 * be vertically compressed by flex-shrink when the total natural height
 * exceeds the viewport. In the production interactive-mode layout the
 * chat history should be able to grow past the viewport without
 * squeezing the editor's two-line border into a single line.
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import { Editor } from "../src/components/editor.ts";
import type { SelectListTheme } from "../src/components/select-list.ts";
import { Text } from "../src/components/text.ts";
import { Container, TUI } from "../src/tui.ts";
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

describe("TUI new engine: flex-shrink must not compress legacy sections", () => {
	function createEditor(tui: TUI): Editor {
		const identity = (s: string) => s;
		const selectListTheme: SelectListTheme = {
			selectedPrefix: identity,
			selectedText: identity,
			description: identity,
			scrollInfo: identity,
			noMatch: identity,
		};
		return new Editor(tui, { borderColor: identity, selectList: selectListTheme }, { paddingX: 1 });
	}

	it("keeps the editor at its natural height when chat overflows viewport", async () => {
		await withEnv({ PI_USE_NEW_TUI_ENGINE: "1" }, async () => {
			const terminal = new VirtualTerminal(80, 12);
			const tui = new TUI(terminal);
			tui.start();
			tui.setFocus(tui as any);

			const chatContainer = new Container();
			const editor = createEditor(tui);
			const footer = new Text("footer", 0, 0);

			tui.addChild(chatContainer);
			tui.addChild(editor);
			tui.addChild(footer);

			// Fill chat with enough messages to overflow the 12-row viewport.
			for (let i = 0; i < 30; i++) {
				chatContainer.addChild(new Text(`chat message ${i + 1}`, 0, 0));
			}

			tui.requestRender();
			await terminal.waitForRender();

			const viewport = terminal.getViewport();

			// The editor must render both its top and bottom border.
			// When compressed, only the top border is visible and the bottom
			// border is pushed out of the viewport.
			const allContent = viewport.join("\n");
			const topBorderCount = (
				allContent.match(/────────────────────────────────────────────────────────────────────────────────/g) || []
			).length;
			assert.strictEqual(
				topBorderCount,
				2,
				`editor should render both top and bottom borders, got ${topBorderCount} border row(s):\n${allContent}`,
			);

			const footerRow = viewport[viewport.length - 1];
			assert.ok(
				footerRow?.includes("footer"),
				`footer should remain visible, got: ${JSON.stringify(viewport.slice(-4))}`,
			);

			tui.stop();
		});
	});

	it("starts from the top when total content fits in the viewport", async () => {
		await withEnv({ PI_USE_NEW_TUI_ENGINE: "1" }, async () => {
			const terminal = new VirtualTerminal(80, 12);
			const tui = new TUI(terminal);
			tui.start();
			tui.setFocus(tui as any);

			const chatContainer = new Container();
			const editor = createEditor(tui);
			const footer = new Text("footer", 0, 0);

			tui.addChild(chatContainer);
			tui.addChild(editor);
			tui.addChild(footer);

			chatContainer.addChild(new Text("first", 0, 0));
			chatContainer.addChild(new Text("second", 0, 0));

			tui.requestRender();
			await terminal.waitForRender();

			const viewport = terminal.getViewport();
			assert.ok(
				viewport[0]?.includes("first"),
				`content should start at the top, got: ${JSON.stringify(viewport.slice(0, 3))}`,
			);

			tui.stop();
		});
	});
});
