import assert from "node:assert";
import { describe, it } from "node:test";
import { getBaseDirection, reorderVisual, stripBidiControls } from "../src/bidi.ts";
import { appendChild, createNode, setTextContent } from "../src/dom/tree.ts";
import { squashText } from "../src/output/squash-text.ts";
import { visibleWidth } from "../src/utils.ts";

// --
// getBaseDirection

describe("getBaseDirection", () => {
	it("returns 'ltr' for ASCII letters", () => {
		assert.strictEqual(getBaseDirection("Hello"), "ltr");
	});

	it("returns 'rtl' for Arabic text", () => {
		assert.strictEqual(getBaseDirection("مرحبا"), "rtl");
	});

	it("returns 'rtl' for Hebrew text", () => {
		assert.strictEqual(getBaseDirection("שלום"), "rtl");
	});

	it("returns 'neutral' for digits only", () => {
		assert.strictEqual(getBaseDirection("123"), "neutral");
	});

	it("returns 'neutral' for punctuation only", () => {
		assert.strictEqual(getBaseDirection("!@#"), "neutral");
	});

	it("returns 'neutral' for empty string", () => {
		assert.strictEqual(getBaseDirection(""), "neutral");
	});

	it("returns 'ltr' when LTR letter precedes RTL letter", () => {
		// First strong character determines base direction
		assert.strictEqual(getBaseDirection("abcمرحبا"), "ltr");
	});

	it("returns 'rtl' when RTL letter precedes LTR letter", () => {
		assert.strictEqual(getBaseDirection("مرحباabc"), "rtl");
	});
});

// --
// stripBidiControls

describe("stripBidiControls", () => {
	it("strips LRM (U+200E)", () => {
		assert.strictEqual(stripBidiControls("Hello\u200E"), "Hello");
	});

	it("strips RLM (U+200F)", () => {
		assert.strictEqual(stripBidiControls("Hello\u200F"), "Hello");
	});

	it("strips RLE/PDF pair (U+202B/U+202C)", () => {
		assert.strictEqual(stripBidiControls("\u202Bمرحبا\u202C"), "مرحبا");
	});

	it("strips LRE, LRO, RLO (U+202A, U+202D, U+202E)", () => {
		assert.strictEqual(stripBidiControls("\u202A\u202D\u202Eabc"), "abc");
	});

	it("leaves normal text unchanged", () => {
		assert.strictEqual(stripBidiControls("abc 123"), "abc 123");
	});

	it("leaves empty string unchanged", () => {
		assert.strictEqual(stripBidiControls(""), "");
	});

	it("strips multiple controls interleaved with text", () => {
		assert.strictEqual(stripBidiControls("a\u200Eb\u202Ec\u200Fd"), "abcd");
	});
});

// --
// reorderVisual

describe("reorderVisual", () => {
	it("returns empty array for empty string", () => {
		assert.deepStrictEqual(reorderVisual(""), []);
	});

	it("preserves order for pure LTR text", () => {
		const result = reorderVisual("Hello");
		assert.strictEqual(result.length, 5);
		assert.strictEqual(result[0].char, "H");
		assert.strictEqual(result[0].visualIndex, 0);
		assert.strictEqual(result[0].logicalIndex, 0);
		assert.strictEqual(result[4].char, "o");
		assert.strictEqual(result[4].visualIndex, 4);
		assert.strictEqual(result[4].logicalIndex, 4);
	});

	it("reverses pure RTL Arabic text", () => {
		// Logical order: م ر ح ب ا (m-r-h-b-a)
		// Visual order:   ا ب ح ر م
		const result = reorderVisual("مرحبا");
		assert.strictEqual(result.length, 5);
		assert.strictEqual(result[0].char, "ا");
		assert.strictEqual(result[0].visualIndex, 0);
		assert.strictEqual(result[0].logicalIndex, 4);
		assert.strictEqual(result[4].char, "م");
		assert.strictEqual(result[4].visualIndex, 4);
		assert.strictEqual(result[4].logicalIndex, 0);
	});

	it("reverses pure RTL Hebrew text", () => {
		// Logical: ש ל ו ם
		// Visual:  ם ו ל ש
		const result = reorderVisual("שלום");
		assert.strictEqual(result.length, 4);
		assert.strictEqual(result[0].char, "ם");
		assert.strictEqual(result[0].logicalIndex, 3);
		assert.strictEqual(result[3].char, "ש");
		assert.strictEqual(result[3].logicalIndex, 0);
	});

	it("handles mixed LTR + RTL preserving LTR order and reversing RTL run", () => {
		// Logical: H e l l o (space) م ر ح ب ا
		// Visual:  H e l l o (space) ا ب ح ر م
		const result = reorderVisual("Hello مرحبا");
		assert.strictEqual(result.length, 11);
		// LTR part preserved
		assert.strictEqual(result[0].char, "H");
		assert.strictEqual(result[0].logicalIndex, 0);
		assert.strictEqual(result[4].char, "o");
		assert.strictEqual(result[4].logicalIndex, 4);
		// space at visual index 5, logical 5
		assert.strictEqual(result[5].char, " ");
		assert.strictEqual(result[5].logicalIndex, 5);
		// RTL run reversed: visual[6]=ا (logical 10), visual[10]=م (logical 6)
		assert.strictEqual(result[6].char, "ا");
		assert.strictEqual(result[6].logicalIndex, 10);
		assert.strictEqual(result[10].char, "م");
		assert.strictEqual(result[10].logicalIndex, 6);
	});

	it("assigns sequential visualIndex starting at 0", () => {
		const result = reorderVisual("abc");
		for (let i = 0; i < result.length; i++) {
			assert.strictEqual(result[i].visualIndex, i);
		}
	});

	it("strips bidi control characters before reordering", () => {
		// LRM should be stripped, not counted as a grapheme
		const result = reorderVisual("Hi\u200E");
		assert.strictEqual(result.length, 2);
		assert.strictEqual(result[0].char, "H");
		assert.strictEqual(result[1].char, "i");
	});
});

// --
// squash-text integration: visual reordering of segment text

describe("squashText: RTL visual reordering", () => {
	it("reorders pure RTL text to visual order in segment output", () => {
		const root = createNode("ink-root");
		const text = createNode("ink-text");
		// Logical order: م ر ح ب ا  (m-r-h-b-a)
		// Visual order:   ا ب ح ر م
		setTextContent(text, "مرحبا");
		appendChild(root, text);

		const segments = squashText(text);
		assert.strictEqual(segments.length, 1);
		assert.strictEqual(segments[0].text, "ابحرم");
	});

	it("preserves LTR text order in segment output", () => {
		const root = createNode("ink-root");
		const text = createNode("ink-text");
		setTextContent(text, "Hello");
		appendChild(root, text);

		const segments = squashText(text);
		assert.strictEqual(segments.length, 1);
		assert.strictEqual(segments[0].text, "Hello");
	});

	it("reorders mixed LTR + RTL preserving LTR run and reversing RTL run", () => {
		const root = createNode("ink-root");
		const text = createNode("ink-text");
		// Logical: "Hello مرحبا"
		// Visual:  "Hello ابحرم"  (LTR run kept, RTL run reversed)
		setTextContent(text, "Hello مرحبا");
		appendChild(root, text);

		const segments = squashText(text);
		assert.strictEqual(segments.length, 1);
		assert.strictEqual(segments[0].text, "Hello ابحرم");
	});

	it("strips bidi control characters from segment output", () => {
		const root = createNode("ink-root");
		const text = createNode("ink-text");
		// LRM appended should be stripped
		setTextContent(text, "Hi\u200E");
		appendChild(root, text);

		const segments = squashText(text);
		assert.strictEqual(segments.length, 1);
		assert.strictEqual(segments[0].text, "Hi");
	});
});

// --
// visibleWidth + bidi controls (regression for measure())

describe("visibleWidth: bidi control characters are zero-width", () => {
	it("does not count LRM (U+200E) toward width", () => {
		assert.strictEqual(visibleWidth("Hello\u200E"), 5);
	});

	it("does not count RLM (U+200F) toward width", () => {
		assert.strictEqual(visibleWidth("Hello\u200F"), 5);
	});

	it("does not count LRE/RLE/PDF/LRO/RLO (U+202A-U+202E) toward width", () => {
		assert.strictEqual(visibleWidth("\u202Bمرحبا\u202C"), 5);
	});

	it("computes same width as stripped text", () => {
		const text = "Hello\u200E世界\u202E";
		assert.strictEqual(visibleWidth(text), visibleWidth(stripBidiControls(text)));
	});
});
