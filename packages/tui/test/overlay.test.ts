/**
 * Overlay adapter tests — maps the legacy Overlay system to the new
 * TuiEngine's position: absolute mechanism.
 *
 * Tests cover:
 * 1. overlayOptionsToStyles: all 9 anchors produce correct top/left/right
 * 2. overlayOptionsToStyles: margin, offset, width, maxHeight, row/col
 * 3. OverlayManager.show: overlay node appended to rootNode
 * 4. OverlayManager.hide: overlay node removed from rootNode
 * 5. OverlayManager.setHidden: display toggles between "none" and "flex"
 * 6. z-order: append order determines paint order (first = bottom)
 * 7. visible() callback: display set to "none" when false
 * 8. focus tracking: last shown capturing overlay is focused
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import { createNode, type TuiElement } from "../src/dom/tree.ts";
import { OverlayManager, overlayOptionsToStyles } from "../src/engine/overlay.ts";
import type { Component, OverlayOptions } from "../src/tui.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

// --
// Helpers

/**
 * Minimal Component that returns a fixed set of lines. Used to test
 * overlay measuring and rendering without depending on Box/Text.
 */
class FixedLinesComponent implements Component {
	private readonly lines: string[];
	constructor(lines: string[]) {
		this.lines = lines;
	}
	render(_width: number): string[] {
		return this.lines;
	}
	invalidate(): void {
		// Stateless — nothing to invalidate.
	}
}

/** Default test dimensions. */
const TERM_W = 80;
const TERM_H = 24;
const OVERLAY_W = 20;
const OVERLAY_H = 3;

/**
 * Convenience wrapper calling overlayOptionsToStyles with the default
 * test dimensions. Merges `width: OVERLAY_W` as a default so centering
 * tests get a predictable overlay width; callers can override by
 * passing `width` in `options`.
 */
function stylesFor(options: OverlayOptions, oh = OVERLAY_H) {
	return overlayOptionsToStyles({ width: OVERLAY_W, ...options }, TERM_W, TERM_H, oh);
}

/** Create an OverlayManager backed by a fresh rootNode + VirtualTerminal. */
function makeManager(
	cols = TERM_W,
	rows = TERM_H,
): {
	manager: OverlayManager;
	rootNode: TuiElement;
	terminal: VirtualTerminal;
} {
	const terminal = new VirtualTerminal(cols, rows);
	const rootNode = createNode("ink-root", { flexDirection: "column", width: "100%", height: "100%" });
	const manager = new OverlayManager(rootNode, terminal);
	return { manager, rootNode, terminal };
}

// --
// SubTask 18.1: overlayOptionsToStyles — 9 anchors

describe("overlayOptionsToStyles: 9 anchors", () => {
	it("center: sets top and left for centering", () => {
		const s = stylesFor({ anchor: "center" });
		assert.strictEqual(s.position, "absolute");
		// top = floor((24 - 3) / 2) = 10
		assert.strictEqual(s.top, 10, "center top should be floor((24-3)/2)=10");
		// left = floor((80 - 20) / 2) = 30
		assert.strictEqual(s.left, 30, "center left should be floor((80-20)/2)=30");
		assert.strictEqual(s.bottom, undefined);
		assert.strictEqual(s.right, undefined);
	});

	it("top-left: sets top=0, left=0", () => {
		const s = stylesFor({ anchor: "top-left" });
		assert.strictEqual(s.top, 0);
		assert.strictEqual(s.left, 0);
		assert.strictEqual(s.bottom, undefined);
		assert.strictEqual(s.right, undefined);
	});

	it("top-right: sets top=0, right=0", () => {
		const s = stylesFor({ anchor: "top-right" });
		assert.strictEqual(s.top, 0);
		assert.strictEqual(s.right, 0);
		assert.strictEqual(s.bottom, undefined);
		assert.strictEqual(s.left, undefined);
	});

	it("bottom-left: sets bottom=0, left=0", () => {
		const s = stylesFor({ anchor: "bottom-left" });
		assert.strictEqual(s.bottom, 0);
		assert.strictEqual(s.left, 0);
		assert.strictEqual(s.top, undefined);
		assert.strictEqual(s.right, undefined);
	});

	it("bottom-right: sets bottom=0, right=0", () => {
		const s = stylesFor({ anchor: "bottom-right" });
		assert.strictEqual(s.bottom, 0);
		assert.strictEqual(s.right, 0);
		assert.strictEqual(s.top, undefined);
		assert.strictEqual(s.left, undefined);
	});

	it("top-center: sets top=0, left centered", () => {
		const s = stylesFor({ anchor: "top-center" });
		assert.strictEqual(s.top, 0);
		// left = floor((80 - 20) / 2) = 30
		assert.strictEqual(s.left, 30);
		assert.strictEqual(s.bottom, undefined);
		assert.strictEqual(s.right, undefined);
	});

	it("bottom-center: sets bottom=0, left centered", () => {
		const s = stylesFor({ anchor: "bottom-center" });
		assert.strictEqual(s.bottom, 0);
		// left = floor((80 - 20) / 2) = 30
		assert.strictEqual(s.left, 30);
		assert.strictEqual(s.top, undefined);
		assert.strictEqual(s.right, undefined);
	});

	it("left-center: sets top centered, left=0", () => {
		const s = stylesFor({ anchor: "left-center" });
		// top = floor((24 - 3) / 2) = 10
		assert.strictEqual(s.top, 10);
		assert.strictEqual(s.left, 0);
		assert.strictEqual(s.bottom, undefined);
		assert.strictEqual(s.right, undefined);
	});

	it("right-center: sets top centered, right=0", () => {
		const s = stylesFor({ anchor: "right-center" });
		// top = floor((24 - 3) / 2) = 10
		assert.strictEqual(s.top, 10);
		assert.strictEqual(s.right, 0);
		assert.strictEqual(s.bottom, undefined);
		assert.strictEqual(s.left, undefined);
	});
});

// --
// overlayOptionsToStyles: margin, offset, width, maxHeight, row/col

describe("overlayOptionsToStyles: margin", () => {
	it("applies uniform margin (number) to all edges", () => {
		// margin = 2 → availWidth = 76, availHeight = 20
		const s = stylesFor({ anchor: "top-left", margin: 2 });
		assert.strictEqual(s.top, 2, "top-left top should be marginTop=2");
		assert.strictEqual(s.left, 2, "top-left left should be marginLeft=2");
	});

	it("applies per-side margin (object)", () => {
		const s = stylesFor({
			anchor: "bottom-right",
			margin: { top: 1, right: 3, bottom: 5, left: 7 },
		});
		assert.strictEqual(s.bottom, 5, "bottom-right bottom should be marginBottom=5");
		assert.strictEqual(s.right, 3, "bottom-right right should be marginRight=3");
	});

	it("factors margin into centering calculation", () => {
		// margin = 2 → availHeight = 20, availWidth = 76
		// center: top = 2 + floor((20 - 3) / 2) = 2 + 8 = 10
		//         left = 2 + floor((76 - 20) / 2) = 2 + 28 = 30
		const s = stylesFor({ anchor: "center", margin: 2 });
		assert.strictEqual(s.top, 10, "center top with margin=2 should be 2+floor((20-3)/2)=10");
		assert.strictEqual(s.left, 30, "center left with margin=2 should be 2+floor((76-20)/2)=30");
	});
});

describe("overlayOptionsToStyles: offset", () => {
	it("offsetX shifts horizontal position (top-left)", () => {
		const s = stylesFor({ anchor: "top-left", offsetX: 5 });
		assert.strictEqual(s.top, 0);
		assert.strictEqual(s.left, 5, "left should be 0 + offsetX=5");
	});

	it("offsetY shifts vertical position (top-left)", () => {
		const s = stylesFor({ anchor: "top-left", offsetY: 3 });
		assert.strictEqual(s.top, 3, "top should be 0 + offsetY=3");
		assert.strictEqual(s.left, 0);
	});

	it("offsetX shifts horizontal position (top-right, subtracts from right)", () => {
		const s = stylesFor({ anchor: "top-right", offsetX: 4 });
		assert.strictEqual(s.right, -4, "right should be 0 - offsetX = -4");
	});

	it("offset combines with centering", () => {
		// center: top = floor((24-3)/2) + offsetY = 10 + 2 = 12
		//         left = floor((80-20)/2) + offsetX = 30 + 6 = 36
		const s = stylesFor({ anchor: "center", offsetX: 6, offsetY: 2 });
		assert.strictEqual(s.top, 12);
		assert.strictEqual(s.left, 36);
	});
});

describe("overlayOptionsToStyles: width", () => {
	it("sets explicit numeric width", () => {
		const s = stylesFor({ anchor: "center", width: 40 });
		assert.strictEqual(s.width, 40);
	});

	it("parses percentage width", () => {
		// "50%" of 80 = 40
		const s = stylesFor({ anchor: "center", width: "50%" });
		assert.strictEqual(s.width, 40);
	});

	it("minWidth overrides width when larger", () => {
		const s = stylesFor({ anchor: "center", width: 20, minWidth: 50 });
		assert.strictEqual(s.width, 50, "width should be clamped up to minWidth=50");
	});

	it("defaults to min(80, termWidth) when width is not set", () => {
		// Call directly without the stylesFor default width.
		const s = overlayOptionsToStyles({ anchor: "center" }, TERM_W, TERM_H, OVERLAY_H);
		assert.strictEqual(s.width, 80, "default width should be min(80, 80) = 80");
	});
});

describe("overlayOptionsToStyles: maxHeight", () => {
	it("sets numeric maxHeight", () => {
		const s = stylesFor({ anchor: "center", maxHeight: 10 });
		assert.strictEqual(s.maxHeight, 10);
	});

	it("parses percentage maxHeight", () => {
		// "50%" of 24 = 12
		const s = stylesFor({ anchor: "center", maxHeight: "50%" });
		assert.strictEqual(s.maxHeight, 12);
	});
});

describe("overlayOptionsToStyles: explicit row/col", () => {
	it("row overrides anchor vertical position", () => {
		// anchor = center but row = 5 → top = 5
		const s = stylesFor({ anchor: "center", row: 5 });
		assert.strictEqual(s.top, 5, "row=5 should set top=5, overriding center anchor");
		assert.strictEqual(s.bottom, undefined);
	});

	it("col overrides anchor horizontal position", () => {
		// anchor = center but col = 10 → left = 10
		const s = stylesFor({ anchor: "center", col: 10 });
		assert.strictEqual(s.left, 10, "col=10 should set left=10, overriding center anchor");
		assert.strictEqual(s.right, undefined);
	});

	it("percentage row is resolved against termHeight", () => {
		// "25%" of 24 = 6
		const s = stylesFor({ anchor: "center", row: "25%" });
		assert.strictEqual(s.top, 6);
	});

	it("percentage col is resolved against termWidth", () => {
		// "50%" of 80 = 40
		const s = stylesFor({ anchor: "center", col: "50%" });
		assert.strictEqual(s.left, 40);
	});
});

// --
// SubTask 18.2: OverlayManager — show / hide / setHidden / z-order

describe("OverlayManager: show", () => {
	it("appends overlay node to rootNode", () => {
		const { manager, rootNode } = makeManager();
		assert.strictEqual(rootNode.childNodes.length, 0);
		const handle = manager.show(new FixedLinesComponent(["A"]), { anchor: "center" });
		assert.strictEqual(rootNode.childNodes.length, 1);
		assert.strictEqual(rootNode.childNodes[0], handle.node);
	});

	it("wraps component as ink-legacy node with position: absolute", () => {
		const { manager } = makeManager();
		const handle = manager.show(new FixedLinesComponent(["A"]), { anchor: "top-left" });
		assert.strictEqual(handle.node.nodeName, "ink-legacy");
		assert.strictEqual(handle.node.style.position, "absolute");
	});

	it("pre-renders component to measure height for centering", () => {
		const { manager } = makeManager();
		// 5-line component, centered in 24-row terminal
		const handle = manager.show(new FixedLinesComponent(["1", "2", "3", "4", "5"]), { anchor: "center", width: 20 });
		// top = floor((24 - 5) / 2) = 9
		assert.strictEqual(handle.node.style.top, 9, "centered 5-line overlay should have top=9");
	});
});

describe("OverlayManager: hide", () => {
	it("removes overlay node from rootNode", () => {
		const { manager, rootNode } = makeManager();
		const handle = manager.show(new FixedLinesComponent(["A"]), { anchor: "center" });
		assert.strictEqual(rootNode.childNodes.length, 1);
		handle.hide();
		assert.strictEqual(rootNode.childNodes.length, 0, "rootNode should have 0 children after hide");
	});

	it("handle.node stays valid after hide (captured reference)", () => {
		const { manager } = makeManager();
		const handle = manager.show(new FixedLinesComponent(["A"]), { anchor: "center" });
		handle.hide();
		// Should not throw — node is captured in the handle closure.
		assert.strictEqual(handle.node.nodeName, "ink-legacy");
	});

	it("hide is idempotent (calling twice is a no-op)", () => {
		const { manager, rootNode } = makeManager();
		const handle = manager.show(new FixedLinesComponent(["A"]), { anchor: "center" });
		handle.hide();
		assert.strictEqual(rootNode.childNodes.length, 0);
		// Second hide should not throw or change anything.
		handle.hide();
		assert.strictEqual(rootNode.childNodes.length, 0);
	});
});

describe("OverlayManager: setHidden", () => {
	it("setHidden(true) sets display: none", () => {
		const { manager } = makeManager();
		const handle = manager.show(new FixedLinesComponent(["A"]), { anchor: "center" });
		assert.strictEqual(handle.isHidden(), false);
		assert.notStrictEqual(handle.node.style.display, "none");
		handle.setHidden(true);
		assert.strictEqual(handle.isHidden(), true);
		assert.strictEqual(handle.node.style.display, "none");
	});

	it("setHidden(false) restores display to flex", () => {
		const { manager } = makeManager();
		const handle = manager.show(new FixedLinesComponent(["A"]), { anchor: "center" });
		handle.setHidden(true);
		assert.strictEqual(handle.node.style.display, "none");
		handle.setHidden(false);
		assert.strictEqual(handle.isHidden(), false);
		assert.strictEqual(handle.node.style.display, "flex");
	});

	it("setHidden is idempotent", () => {
		const { manager } = makeManager();
		const handle = manager.show(new FixedLinesComponent(["A"]), { anchor: "center" });
		handle.setHidden(true);
		handle.setHidden(true); // no-op
		assert.strictEqual(handle.isHidden(), true);
		assert.strictEqual(handle.node.style.display, "none");
	});
});

// --
// z-order

describe("OverlayManager: z-order", () => {
	it("first shown overlay is first child (paints on bottom)", () => {
		const { manager, rootNode } = makeManager();
		const h1 = manager.show(new FixedLinesComponent(["A"]), { anchor: "top-left" });
		const h2 = manager.show(new FixedLinesComponent(["B"]), { anchor: "top-right" });
		assert.strictEqual(rootNode.childNodes.length, 2);
		// First shown = first child = bottom
		assert.strictEqual(rootNode.childNodes[0], h1.node, "first overlay should be first child");
		assert.strictEqual(rootNode.childNodes[1], h2.node, "second overlay should be second child (on top)");
	});

	it("removing a middle overlay preserves relative order of remaining", () => {
		const { manager, rootNode } = makeManager();
		const h1 = manager.show(new FixedLinesComponent(["A"]), { anchor: "top-left" });
		const h2 = manager.show(new FixedLinesComponent(["B"]), { anchor: "center" });
		const h3 = manager.show(new FixedLinesComponent(["C"]), { anchor: "bottom-right" });
		// Remove h2 (the middle one)
		h2.hide();
		assert.strictEqual(rootNode.childNodes.length, 2);
		assert.strictEqual(rootNode.childNodes[0], h1.node);
		assert.strictEqual(rootNode.childNodes[1], h3.node);
	});
});

// --
// visible() callback

describe("OverlayManager: visible callback", () => {
	it("visible() returning false hides overlay at show time", () => {
		const { manager } = makeManager();
		const handle = manager.show(new FixedLinesComponent(["A"]), {
			anchor: "center",
			visible: () => false,
		});
		assert.strictEqual(handle.isHidden(), true, "overlay should be hidden when visible() returns false");
		assert.strictEqual(handle.node.style.display, "none");
	});

	it("visible() returning true shows overlay normally", () => {
		const { manager } = makeManager();
		const handle = manager.show(new FixedLinesComponent(["A"]), {
			anchor: "center",
			visible: () => true,
		});
		assert.strictEqual(handle.isHidden(), false);
		assert.notStrictEqual(handle.node.style.display, "none");
	});
});

// --
// Focus tracking

describe("OverlayManager: focus tracking", () => {
	it("last shown capturing overlay is focused", () => {
		const { manager } = makeManager();
		const h1 = manager.show(new FixedLinesComponent(["A"]), { anchor: "center" });
		const h2 = manager.show(new FixedLinesComponent(["B"]), { anchor: "center" });
		assert.strictEqual(h1.isFocused(), false, "first overlay should not be focused");
		assert.strictEqual(h2.isFocused(), true, "second (last shown) overlay should be focused");
	});

	it("focus() switches focused overlay", () => {
		const { manager } = makeManager();
		const h1 = manager.show(new FixedLinesComponent(["A"]), { anchor: "center" });
		const h2 = manager.show(new FixedLinesComponent(["B"]), { anchor: "center" });
		assert.strictEqual(h2.isFocused(), true);
		h1.focus();
		assert.strictEqual(h1.isFocused(), true);
		assert.strictEqual(h2.isFocused(), false);
	});

	it("unfocus() moves focus to next visible capturing overlay", () => {
		const { manager } = makeManager();
		const h1 = manager.show(new FixedLinesComponent(["A"]), { anchor: "center" });
		const h2 = manager.show(new FixedLinesComponent(["B"]), { anchor: "center" });
		h2.unfocus();
		assert.strictEqual(h2.isFocused(), false);
		assert.strictEqual(h1.isFocused(), true, "focus should return to h1");
	});

	it("hide() moves focus to next visible capturing overlay", () => {
		const { manager } = makeManager();
		const h1 = manager.show(new FixedLinesComponent(["A"]), { anchor: "center" });
		const h2 = manager.show(new FixedLinesComponent(["B"]), { anchor: "center" });
		h2.hide();
		assert.strictEqual(h1.isFocused(), true, "focus should return to h1 after h2 is hidden");
	});

	it("nonCapturing overlay does not steal focus", () => {
		const { manager } = makeManager();
		const h1 = manager.show(new FixedLinesComponent(["A"]), { anchor: "center" });
		const h2 = manager.show(new FixedLinesComponent(["B"]), {
			anchor: "center",
			nonCapturing: true,
		});
		assert.strictEqual(h1.isFocused(), true, "h1 should remain focused");
		assert.strictEqual(h2.isFocused(), false, "nonCapturing overlay should not be focused");
	});
});
