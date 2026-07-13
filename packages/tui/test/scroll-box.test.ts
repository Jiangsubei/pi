/**
 * ScrollBox tests — Task 23.
 *
 * Validates the ScrollBox scroll container: scrollTop offset rendering,
 * scroll API (scrollTo/scrollBy/scrollToBottom), stickyScroll follow,
 * and ↑N/↓N more indicators.
 *
 * Uses the CapturingVirtualTerminal pattern from engine-render.test.ts.
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import { TuiEngine } from "../src/engine.ts";
import { dispatchEvent } from "../src/events/dispatcher.ts";
import { KeyboardEvent } from "../src/events/synthetic-event.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

// --
// Helpers

class CapturingVirtualTerminal extends VirtualTerminal {
	readonly writes: string[] = [];

	write(data: string): void {
		this.writes.push(data);
		super.write(data);
	}

	clearWrites(): void {
		this.writes.length = 0;
	}
}

function setupEngine(cols = 20, rows = 10): { terminal: CapturingVirtualTerminal; engine: TuiEngine } {
	const terminal = new CapturingVirtualTerminal(cols, rows);
	terminal.start(
		() => undefined,
		() => undefined,
	);
	const engine = new TuiEngine(terminal);
	terminal.clearWrites();
	return { terminal, engine };
}

function rowText(viewport: string[], y: number): string {
	return (viewport[y] ?? "").trimEnd();
}

// --
// Tests

describe("scroll-box: basic rendering", () => {
	it("renders first lines and clips overflow when scrollTop=0", async () => {
		const { terminal, engine } = setupEngine(10, 5);
		const scrollBox = engine.createScrollBox({ height: 3 });
		for (let i = 0; i < 5; i++) {
			engine.appendChild(scrollBox, engine.createText(`L${i}`));
		}
		engine.appendChild(engine.rootNode, scrollBox);
		engine.start();
		await terminal.waitForRender();
		const viewport = terminal.getViewport();
		assert.ok(
			rowText(viewport, 0).startsWith("L0"),
			`row 0 should start with L0, got: ${JSON.stringify(viewport[0])}`,
		);
		assert.ok(
			rowText(viewport, 1).startsWith("L1"),
			`row 1 should start with L1, got: ${JSON.stringify(viewport[1])}`,
		);
		assert.ok(
			rowText(viewport, 2).startsWith("L2"),
			`row 2 should start with L2, got: ${JSON.stringify(viewport[2])}`,
		);
		assert.strictEqual(rowText(viewport, 3), "", `row 3 should be empty, got: ${JSON.stringify(viewport[3])}`);
		assert.strictEqual(rowText(viewport, 4), "", `row 4 should be empty, got: ${JSON.stringify(viewport[4])}`);
		engine.stop();
		terminal.stop();
	});

	it("does not render indicators when content fits", async () => {
		const { terminal, engine } = setupEngine(15, 5);
		const scrollBox = engine.createScrollBox({ height: 5 });
		for (let i = 0; i < 3; i++) {
			engine.appendChild(scrollBox, engine.createText(`L${i}`));
		}
		engine.appendChild(engine.rootNode, scrollBox);
		engine.start();
		await terminal.waitForRender();
		const viewport = terminal.getViewport();
		assert.ok(!viewport[0].includes("\u2191"), `top row should not have up arrow: ${JSON.stringify(viewport[0])}`);
		assert.ok(
			!viewport[4].includes("\u2193"),
			`bottom row should not have down arrow: ${JSON.stringify(viewport[4])}`,
		);
		engine.stop();
		terminal.stop();
	});
});

describe("scroll-box: scroll API", () => {
	it("scrollTo shows lines at given offset", async () => {
		const { terminal, engine } = setupEngine(10, 5);
		const scrollBox = engine.createScrollBox({ height: 3 });
		for (let i = 0; i < 5; i++) {
			engine.appendChild(scrollBox, engine.createText(`L${i}`));
		}
		engine.appendChild(engine.rootNode, scrollBox);
		engine.start();
		await terminal.waitForRender();
		scrollBox.scrollTo(2);
		await terminal.waitForRender();
		const viewport = terminal.getViewport();
		assert.ok(rowText(viewport, 0).startsWith("L2"), `row 0 should be L2, got: ${JSON.stringify(viewport[0])}`);
		assert.ok(rowText(viewport, 1).startsWith("L3"), `row 1 should be L3, got: ${JSON.stringify(viewport[1])}`);
		assert.ok(rowText(viewport, 2).startsWith("L4"), `row 2 should be L4, got: ${JSON.stringify(viewport[2])}`);
		engine.stop();
		terminal.stop();
	});

	it("scrollBy adds delta to scrollTop", async () => {
		const { terminal, engine } = setupEngine(10, 5);
		const scrollBox = engine.createScrollBox({ height: 3 });
		for (let i = 0; i < 5; i++) {
			engine.appendChild(scrollBox, engine.createText(`L${i}`));
		}
		engine.appendChild(engine.rootNode, scrollBox);
		engine.start();
		await terminal.waitForRender();
		scrollBox.scrollBy(1);
		await terminal.waitForRender();
		let viewport = terminal.getViewport();
		assert.ok(
			rowText(viewport, 0).startsWith("L1"),
			`after scrollBy(1) row 0 should be L1, got: ${JSON.stringify(viewport[0])}`,
		);
		assert.ok(
			rowText(viewport, 1).startsWith("L2"),
			`after scrollBy(1) row 1 should be L2, got: ${JSON.stringify(viewport[1])}`,
		);
		assert.ok(
			rowText(viewport, 2).startsWith("L3"),
			`after scrollBy(1) row 2 should be L3, got: ${JSON.stringify(viewport[2])}`,
		);
		scrollBox.scrollBy(-1);
		await terminal.waitForRender();
		viewport = terminal.getViewport();
		assert.ok(
			rowText(viewport, 0).startsWith("L0"),
			`after scrollBy(-1) row 0 should be L0, got: ${JSON.stringify(viewport[0])}`,
		);
		assert.ok(
			rowText(viewport, 1).startsWith("L1"),
			`after scrollBy(-1) row 1 should be L1, got: ${JSON.stringify(viewport[1])}`,
		);
		assert.ok(
			rowText(viewport, 2).startsWith("L2"),
			`after scrollBy(-1) row 2 should be L2, got: ${JSON.stringify(viewport[2])}`,
		);
		engine.stop();
		terminal.stop();
	});

	it("scrollToBottom shows last lines", async () => {
		const { terminal, engine } = setupEngine(10, 5);
		const scrollBox = engine.createScrollBox({ height: 3 });
		for (let i = 0; i < 5; i++) {
			engine.appendChild(scrollBox, engine.createText(`L${i}`));
		}
		engine.appendChild(engine.rootNode, scrollBox);
		engine.start();
		await terminal.waitForRender();
		scrollBox.scrollToBottom();
		await terminal.waitForRender();
		const viewport = terminal.getViewport();
		assert.ok(rowText(viewport, 0).startsWith("L2"), `row 0 should be L2, got: ${JSON.stringify(viewport[0])}`);
		assert.ok(rowText(viewport, 1).startsWith("L3"), `row 1 should be L3, got: ${JSON.stringify(viewport[1])}`);
		assert.ok(rowText(viewport, 2).startsWith("L4"), `row 2 should be L4, got: ${JSON.stringify(viewport[2])}`);
		engine.stop();
		terminal.stop();
	});

	it("scrollTo clamps to [0, maxScroll]", async () => {
		const { terminal, engine } = setupEngine(10, 5);
		const scrollBox = engine.createScrollBox({ height: 3 });
		for (let i = 0; i < 5; i++) {
			engine.appendChild(scrollBox, engine.createText(`L${i}`));
		}
		engine.appendChild(engine.rootNode, scrollBox);
		engine.start();
		await terminal.waitForRender();
		scrollBox.scrollTo(100);
		await terminal.waitForRender();
		let viewport = terminal.getViewport();
		assert.ok(
			rowText(viewport, 0).startsWith("L2"),
			`scrollTo(100) should clamp to maxScroll=2, row 0: ${JSON.stringify(viewport[0])}`,
		);
		scrollBox.scrollTo(-5);
		await terminal.waitForRender();
		viewport = terminal.getViewport();
		assert.ok(
			rowText(viewport, 0).startsWith("L0"),
			`scrollTo(-5) should clamp to 0, row 0: ${JSON.stringify(viewport[0])}`,
		);
		engine.stop();
		terminal.stop();
	});

	it("page scroll via scrollBy(contentHeight)", async () => {
		const { terminal, engine } = setupEngine(10, 5);
		const scrollBox = engine.createScrollBox({ height: 3 });
		for (let i = 0; i < 7; i++) {
			engine.appendChild(scrollBox, engine.createText(`L${i}`));
		}
		engine.appendChild(engine.rootNode, scrollBox);
		engine.start();
		await terminal.waitForRender();
		scrollBox.scrollBy(3);
		await terminal.waitForRender();
		const viewport = terminal.getViewport();
		assert.ok(
			rowText(viewport, 0).startsWith("L3"),
			`after page down row 0 should be L3, got: ${JSON.stringify(viewport[0])}`,
		);
		assert.ok(
			rowText(viewport, 2).startsWith("L5"),
			`after page down row 2 should be L5, got: ${JSON.stringify(viewport[2])}`,
		);
		engine.stop();
		terminal.stop();
	});
});

describe("scroll-box: stickyScroll", () => {
	it("keeps bottom visible when appending children", async () => {
		const { terminal, engine } = setupEngine(10, 5);
		const scrollBox = engine.createScrollBox({ height: 3, stickyScroll: true });
		engine.appendChild(scrollBox, engine.createText("L0"));
		engine.appendChild(scrollBox, engine.createText("L1"));
		engine.appendChild(scrollBox, engine.createText("L2"));
		engine.appendChild(engine.rootNode, scrollBox);
		engine.start();
		await terminal.waitForRender();
		let viewport = terminal.getViewport();
		assert.ok(
			rowText(viewport, 2).startsWith("L2"),
			`initial bottom should be L2, got: ${JSON.stringify(viewport[2])}`,
		);
		engine.appendChild(scrollBox, engine.createText("L3"));
		await terminal.waitForRender();
		viewport = terminal.getViewport();
		assert.ok(
			rowText(viewport, 1).startsWith("L2"),
			`after append row 1 should be L2, got: ${JSON.stringify(viewport[1])}`,
		);
		assert.ok(
			rowText(viewport, 2).startsWith("L3"),
			`after append row 2 should be L3 (bottom), got: ${JSON.stringify(viewport[2])}`,
		);
		engine.stop();
		terminal.stop();
	});

	it("does not follow when user scrolled up", async () => {
		const { terminal, engine } = setupEngine(10, 5);
		const scrollBox = engine.createScrollBox({ height: 3, stickyScroll: true });
		for (let i = 0; i < 5; i++) {
			engine.appendChild(scrollBox, engine.createText(`L${i}`));
		}
		engine.appendChild(engine.rootNode, scrollBox);
		engine.start();
		await terminal.waitForRender();
		scrollBox.scrollTo(0);
		await terminal.waitForRender();
		engine.appendChild(scrollBox, engine.createText("L5"));
		await terminal.waitForRender();
		const viewport = terminal.getViewport();
		assert.ok(rowText(viewport, 0).startsWith("L0"), `row 0 should stay L0, got: ${JSON.stringify(viewport[0])}`);
		assert.ok(rowText(viewport, 2).startsWith("L2"), `row 2 should stay L2, got: ${JSON.stringify(viewport[2])}`);
		engine.stop();
		terminal.stop();
	});
});

describe("scroll-box: scroll indicators", () => {
	it("renders up arrow indicator when scrollTop > 0", async () => {
		const { terminal, engine } = setupEngine(15, 5);
		const scrollBox = engine.createScrollBox({ height: 3 });
		for (let i = 0; i < 5; i++) {
			engine.appendChild(scrollBox, engine.createText(`L${i}`));
		}
		engine.appendChild(engine.rootNode, scrollBox);
		engine.start();
		await terminal.waitForRender();
		scrollBox.scrollTo(2);
		await terminal.waitForRender();
		const viewport = terminal.getViewport();
		assert.ok(viewport[0].includes("\u2191"), `top row should contain up arrow, got: ${JSON.stringify(viewport[0])}`);
		assert.ok(viewport[0].includes("2"), `top row should contain count "2", got: ${JSON.stringify(viewport[0])}`);
		assert.ok(viewport[0].includes("more"), `top row should contain "more", got: ${JSON.stringify(viewport[0])}`);
		engine.stop();
		terminal.stop();
	});

	it("renders down arrow indicator when scrollTop < maxScroll", async () => {
		const { terminal, engine } = setupEngine(15, 5);
		const scrollBox = engine.createScrollBox({ height: 3 });
		for (let i = 0; i < 5; i++) {
			engine.appendChild(scrollBox, engine.createText(`L${i}`));
		}
		engine.appendChild(engine.rootNode, scrollBox);
		engine.start();
		await terminal.waitForRender();
		const viewport = terminal.getViewport();
		assert.ok(
			viewport[2].includes("\u2193"),
			`bottom row should contain down arrow, got: ${JSON.stringify(viewport[2])}`,
		);
		assert.ok(viewport[2].includes("2"), `bottom row should contain count "2", got: ${JSON.stringify(viewport[2])}`);
		assert.ok(viewport[2].includes("more"), `bottom row should contain "more", got: ${JSON.stringify(viewport[2])}`);
		engine.stop();
		terminal.stop();
	});

	it("renders both indicators when in middle", async () => {
		const { terminal, engine } = setupEngine(15, 5);
		const scrollBox = engine.createScrollBox({ height: 3 });
		for (let i = 0; i < 7; i++) {
			engine.appendChild(scrollBox, engine.createText(`L${i}`));
		}
		engine.appendChild(engine.rootNode, scrollBox);
		engine.start();
		await terminal.waitForRender();
		scrollBox.scrollTo(2);
		await terminal.waitForRender();
		const viewport = terminal.getViewport();
		assert.ok(viewport[0].includes("\u2191"), `top row should contain up arrow, got: ${JSON.stringify(viewport[0])}`);
		assert.ok(
			viewport[2].includes("\u2193"),
			`bottom row should contain down arrow, got: ${JSON.stringify(viewport[2])}`,
		);
		engine.stop();
		terminal.stop();
	});

	it("indicator uses dim styling", async () => {
		const { terminal, engine } = setupEngine(15, 5);
		const scrollBox = engine.createScrollBox({ height: 3 });
		for (let i = 0; i < 5; i++) {
			engine.appendChild(scrollBox, engine.createText(`L${i}`));
		}
		engine.appendChild(engine.rootNode, scrollBox);
		engine.start();
		await terminal.waitForRender();
		terminal.clearWrites();
		scrollBox.scrollTo(2);
		await terminal.waitForRender();
		const output = terminal.writes.join("");
		assert.ok(output.includes("\x1b[2m"), `should contain dim SGR, got: ${JSON.stringify(output)}`);
		engine.stop();
		terminal.stop();
	});
});

describe("scroll-box: scrollTop field", () => {
	it("TuiElement has scrollTop field defaulting to 0", () => {
		const { engine } = setupEngine(10, 5);
		const scrollBox = engine.createScrollBox({ height: 3 });
		assert.strictEqual(scrollBox.scrollTop, 0, `scrollTop should default to 0`);
		engine.stop();
	});

	it("scrollTop is mutable via scroll API", async () => {
		const { terminal, engine } = setupEngine(10, 5);
		const scrollBox = engine.createScrollBox({ height: 3 });
		for (let i = 0; i < 5; i++) {
			engine.appendChild(scrollBox, engine.createText(`L${i}`));
		}
		engine.appendChild(engine.rootNode, scrollBox);
		engine.start();
		await terminal.waitForRender();
		scrollBox.scrollTo(1);
		assert.strictEqual(scrollBox.scrollTop, 1, `after scrollTo(1), scrollTop should be 1`);
		scrollBox.scrollToBottom();
		assert.strictEqual(scrollBox.scrollTop, 2, `after scrollToBottom(), scrollTop should be 2 (maxScroll)`);
		engine.stop();
		terminal.stop();
	});
});

// --
// Keyboard-driven scroll (PageUp / PageDown via keydown listener)
//
// ScrollBox has no built-in key handler — callers wire keydown events to
// scrollBy themselves. This test verifies that integration: a keydown
// listener invoking scrollBy(±contentHeight) produces page scrolling.

describe("scroll-box: keyboard scroll (via keydown listener)", () => {
	it("scrolls down a page on PageDown keydown and back up on PageUp", async () => {
		const { terminal, engine } = setupEngine(10, 5);
		const scrollBox = engine.createScrollBox({ height: 3 });
		for (let i = 0; i < 7; i++) {
			engine.appendChild(scrollBox, engine.createText(`L${i}`));
		}
		engine.appendChild(engine.rootNode, scrollBox);

		// Wire keyboard scrolling: PageDown/PageUp → scrollBy(±contentHeight).
		// This is the pattern a real TUI uses to bind keys to scroll actions.
		scrollBox.addEventListener("keydown", (event) => {
			const ke = event as KeyboardEvent;
			if (ke.key === "pagedown") {
				scrollBox.scrollBy(scrollBox.yogaNode.getComputedHeight());
				ke.preventDefault();
			} else if (ke.key === "pageup") {
				scrollBox.scrollBy(-scrollBox.yogaNode.getComputedHeight());
				ke.preventDefault();
			}
		});

		engine.start();
		await terminal.waitForRender();
		assert.strictEqual(scrollBox.scrollTop, 0, "should start at scrollTop=0");

		// PageDown → scroll down one page (contentHeight = 3).
		dispatchEvent(scrollBox, new KeyboardEvent(scrollBox, { key: "pagedown" }));
		await terminal.waitForRender();
		assert.strictEqual(scrollBox.scrollTop, 3, `after PageDown scrollTop should be 3, got ${scrollBox.scrollTop}`);
		let viewport = terminal.getViewport();
		assert.ok(
			rowText(viewport, 0).startsWith("L3"),
			`after PageDown row 0 should be L3, got: ${JSON.stringify(viewport[0])}`,
		);

		// PageUp → scroll back up one page.
		dispatchEvent(scrollBox, new KeyboardEvent(scrollBox, { key: "pageup" }));
		await terminal.waitForRender();
		assert.strictEqual(scrollBox.scrollTop, 0, `after PageUp scrollTop should be 0, got ${scrollBox.scrollTop}`);
		viewport = terminal.getViewport();
		assert.ok(
			rowText(viewport, 0).startsWith("L0"),
			`after PageUp row 0 should be L0, got: ${JSON.stringify(viewport[0])}`,
		);

		engine.stop();
		terminal.stop();
	});
});
