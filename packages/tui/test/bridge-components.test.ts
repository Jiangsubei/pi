/**
 * P2 integration tests — 11 legacy Components through the Bridge.
 *
 * Verifies that each of the 11 non-Editor components (Box, Text, Spacer,
 * Loader, TruncatedText, Input, SelectList, SettingsList,
 * CancellableLoader, Markdown, Image) renders correctly when wrapped
 * as `ink-legacy` nodes via {@link TuiEngine.wrapComponent} and laid out
 * by the new Yoga-backed engine.
 *
 * Editor has its own dedicated test file (`bridge-editor.test.ts`)
 * because its initialization (TUI + theme + CURSOR_MARKER) is more
 * involved.
 *
 * Each test follows the same pattern:
 * 1. Create a {@link VirtualTerminal} + {@link TuiEngine}.
 * 2. Construct the legacy Component (with stub themes/color fns where
 *    needed — the bridge strips ANSI so identity functions are fine).
 * 3. `engine.wrapComponent(component)` → append to `engine.rootNode`.
 * 4. Start engine, wait for render, assert content appears in viewport.
 *
 * For {@link Focusable} components (Input), additionally verifies that
 * `engine.focusNode` syncs `component.focused = true`.
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import { Box } from "../src/components/box.ts";
import { CancellableLoader } from "../src/components/cancellable-loader.ts";
import { Image } from "../src/components/image.ts";
import { Input } from "../src/components/input.ts";
import { Loader } from "../src/components/loader.ts";
import { Markdown } from "../src/components/markdown.ts";
import { SelectList } from "../src/components/select-list.ts";
import { SettingsList, type SettingsListTheme } from "../src/components/settings-list.ts";
import { Spacer } from "../src/components/spacer.ts";
import { Text } from "../src/components/text.ts";
import { TruncatedText } from "../src/components/truncated-text.ts";
import { TuiEngine } from "../src/engine.ts";
import { resetCapabilitiesCache, setCapabilities } from "../src/terminal-image.ts";
import { TUI } from "../src/tui.ts";
import { defaultMarkdownTheme, defaultSelectListTheme } from "./test-themes.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

// --
// Helpers

/** Identity color function — no styling. Bridge strips ANSI anyway. */
const identity = (s: string): string => s;

/** Minimal SettingsList theme with identity functions. */
const settingsTheme: SettingsListTheme = {
	label: (text: string): string => text,
	value: (text: string): string => text,
	description: (text: string): string => text,
	cursor: "→",
	hint: (text: string): string => text,
};

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

// --
// Tests

describe("bridge-components: 11 components via Bridge", () => {
	it("renders Box with Text children", async () => {
		const { terminal, engine } = createEngine();
		try {
			const box = new Box(0, 0);
			box.addChild(new Text("BoxContent", 0, 0));
			const node = engine.wrapComponent(box);
			engine.appendChild(engine.rootNode, node);

			engine.start();
			await terminal.waitForRender();

			assertInViewport(terminal, "BoxContent");
		} finally {
			engine.stop();
			terminal.stop();
		}
	});

	it("renders Text component", async () => {
		const { terminal, engine } = createEngine();
		try {
			const text = new Text("Hello Text", 0, 0);
			const node = engine.wrapComponent(text);
			engine.appendChild(engine.rootNode, node);

			engine.start();
			await terminal.waitForRender();

			assertInViewport(terminal, "Hello Text");
		} finally {
			engine.stop();
			terminal.stop();
		}
	});

	it("renders Spacer component (measures correct height)", async () => {
		const { terminal, engine } = createEngine();
		try {
			const spacer = new Spacer(3);
			const node = engine.wrapComponent(spacer);
			engine.appendChild(engine.rootNode, node);

			engine.start();
			await terminal.waitForRender();

			// Spacer renders 3 empty lines → node height should be 3.
			assert.strictEqual(
				node.yogaNode.getComputedHeight(),
				3,
				`Spacer(3) node height should be 3, got ${node.yogaNode.getComputedHeight()}`,
			);
		} finally {
			engine.stop();
			terminal.stop();
		}
	});

	it("renders Loader component with message", async () => {
		const { terminal, engine } = createEngine();
		// Loader needs a TUI for requestRender + terminal.rows.
		const tui = new TUI(new VirtualTerminal(80, 24));
		const loader = new Loader(tui, identity, identity, "Loading data...");
		try {
			const node = engine.wrapComponent(loader);
			engine.appendChild(engine.rootNode, node);

			engine.start();
			await terminal.waitForRender();

			assertInViewport(terminal, "Loading data...");
		} finally {
			loader.stop();
			engine.stop();
			terminal.stop();
		}
	});

	it("renders TruncatedText component", async () => {
		const { terminal, engine } = createEngine();
		try {
			const truncated = new TruncatedText("TruncatedHello", 0, 0);
			const node = engine.wrapComponent(truncated);
			engine.appendChild(engine.rootNode, node);

			engine.start();
			await terminal.waitForRender();

			assertInViewport(terminal, "TruncatedHello");
		} finally {
			engine.stop();
			terminal.stop();
		}
	});

	it("renders Input component (Focusable) and syncs focused on focusNode", async () => {
		const { terminal, engine } = createEngine();
		try {
			const input = new Input();
			input.setValue("InputValue");
			const node = engine.wrapComponent(input);
			engine.appendChild(engine.rootNode, node);

			engine.start();
			await terminal.waitForRender();

			assertInViewport(terminal, "InputValue");
			assert.strictEqual(input.focused, false, "Input should start unfocused");

			engine.focusNode(node);
			await terminal.waitForRender();

			assert.strictEqual(input.focused, true, "Input should be focused after engine.focusNode");
			assert.ok(
				node.legacyCursor !== undefined,
				"legacyCursor should be set when focused Input emits CURSOR_MARKER",
			);
		} finally {
			engine.stop();
			terminal.stop();
		}
	});

	it("renders SelectList component with items", async () => {
		const { terminal, engine } = createEngine();
		try {
			const items = [
				{ value: "alpha", label: "Alpha Option" },
				{ value: "beta", label: "Beta Option" },
			];
			const selectList = new SelectList(items, 5, defaultSelectListTheme);
			const node = engine.wrapComponent(selectList);
			engine.appendChild(engine.rootNode, node);

			engine.start();
			await terminal.waitForRender();

			assertInViewport(terminal, "Alpha Option");
			assertInViewport(terminal, "Beta Option");
		} finally {
			engine.stop();
			terminal.stop();
		}
	});

	it("renders SettingsList component with items", async () => {
		const { terminal, engine } = createEngine();
		try {
			const items = [{ id: "setting1", label: "MySetting", currentValue: "On", values: ["On", "Off"] }];
			const settingsList = new SettingsList(
				items,
				5,
				settingsTheme,
				() => {},
				() => {},
			);
			const node = engine.wrapComponent(settingsList);
			engine.appendChild(engine.rootNode, node);

			engine.start();
			await terminal.waitForRender();

			assertInViewport(terminal, "MySetting");
			assertInViewport(terminal, "On");
		} finally {
			engine.stop();
			terminal.stop();
		}
	});

	it("renders CancellableLoader component with message", async () => {
		const { terminal, engine } = createEngine();
		const tui = new TUI(new VirtualTerminal(80, 24));
		const loader = new CancellableLoader(tui, identity, identity, "Cancelling...");
		try {
			const node = engine.wrapComponent(loader);
			engine.appendChild(engine.rootNode, node);

			engine.start();
			await terminal.waitForRender();

			assertInViewport(terminal, "Cancelling...");
		} finally {
			loader.dispose();
			engine.stop();
			terminal.stop();
		}
	});

	it("renders Markdown component with paragraph", async () => {
		const { terminal, engine } = createEngine();
		try {
			const markdown = new Markdown("MarkdownPara", 0, 0, defaultMarkdownTheme);
			const node = engine.wrapComponent(markdown);
			engine.appendChild(engine.rootNode, node);

			engine.start();
			await terminal.waitForRender();

			assertInViewport(terminal, "MarkdownPara");
		} finally {
			engine.stop();
			terminal.stop();
		}
	});

	it("renders Image component (fallback path)", async () => {
		const { terminal, engine } = createEngine();
		// Force no image protocol so the Image component renders its
		// text fallback ([Image: image/png 10x100]).
		setCapabilities({ images: null, trueColor: false, hyperlinks: false });
		try {
			const image = new Image(
				"AAAA",
				"image/png",
				{ fallbackColor: identity },
				{ maxWidthCells: 60 },
				{ widthPx: 10, heightPx: 100 },
			);
			const node = engine.wrapComponent(image);
			engine.appendChild(engine.rootNode, node);

			engine.start();
			await terminal.waitForRender();

			assertInViewport(terminal, "[Image:");
			assertInViewport(terminal, "image/png");
		} finally {
			engine.stop();
			terminal.stop();
			resetCapabilitiesCache();
		}
	});
});
