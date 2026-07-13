import assert from "node:assert";
import { describe, it } from "node:test";
import { appendChild, createNode, setTextContent } from "../src/dom/tree.ts";
import { applyTextStyles, colorizeBg, colorizeFg, colorizeReset } from "../src/output/colorize.ts";
import { Output } from "../src/output/output.ts";
import { BORDER_STYLES, renderBorder } from "../src/output/render-border.ts";
import { renderNode } from "../src/output/render-node.ts";
import { squashText } from "../src/output/squash-text.ts";
import { wrapText } from "../src/output/wrap-text.ts";
import { Screen } from "../src/screen/screen.ts";

// --
// Helpers

/**
 * Build a DOM tree, lay it out, paint it to a fresh Screen, and return
 * the Screen. The root is sized to `width` × `height` before layout.
 */
function paintTree(root: ReturnType<typeof createNode>, width: number, height: number): Screen {
	root.yogaNode.setWidth(width);
	root.yogaNode.setHeight(height);
	root.yogaNode.calculateLayout();
	const screen = new Screen(width, height);
	const output = new Output(screen);
	renderNode(root, output);
	output.flush();
	return screen;
}

/**
 * Extract a row from the screen as a string of characters (for
 * readability in assertions). Wide-character trailing cells (width 0)
 * are skipped.
 */
function rowString(screen: Screen, y: number): string {
	let s = "";
	for (let x = 0; x < screen.width; x++) {
		const cell = screen.getCell(x, y);
		if (cell.width === 0) continue;
		s += cell.char;
	}
	return s;
}

// --
// render-border tests

describe("render-border", () => {
	it("renders round border corners and edges", () => {
		const screen = new Screen(6, 4);
		const output = new Output(screen);
		renderBorder(output, 0, 0, 6, 4, "round", {});
		output.flush();

		// Top:    ╭────╮
		// Sides:  │  │  │  │
		// Bottom: ╰────╯
		assert.strictEqual(rowString(screen, 0), "\u256d\u2500\u2500\u2500\u2500\u256e");
		assert.strictEqual(screen.getCell(0, 1).char, "\u2502");
		assert.strictEqual(screen.getCell(5, 1).char, "\u2502");
		assert.strictEqual(rowString(screen, 3), "\u2570\u2500\u2500\u2500\u2500\u256f");
	});

	it("renders single border with correct characters", () => {
		const screen = new Screen(4, 3);
		const output = new Output(screen);
		renderBorder(output, 0, 0, 4, 3, "single", {});
		output.flush();

		assert.strictEqual(screen.getCell(0, 0).char, "\u250c"); // ┌
		assert.strictEqual(screen.getCell(3, 0).char, "\u2510"); // ┐
		assert.strictEqual(screen.getCell(0, 2).char, "\u2514"); // └
		assert.strictEqual(screen.getCell(3, 2).char, "\u2518"); // ┘
		assert.strictEqual(screen.getCell(1, 0).char, "\u2500"); // ─
		assert.strictEqual(screen.getCell(0, 1).char, "\u2502"); // │
	});

	it("renders double border with correct characters", () => {
		const screen = new Screen(4, 3);
		const output = new Output(screen);
		renderBorder(output, 0, 0, 4, 3, "double", {});
		output.flush();

		assert.strictEqual(screen.getCell(0, 0).char, "\u2554"); // ╔
		assert.strictEqual(screen.getCell(3, 0).char, "\u2557"); // ╗
		assert.strictEqual(screen.getCell(1, 0).char, "\u2550"); // ═
		assert.strictEqual(screen.getCell(0, 1).char, "\u2551"); // ║
	});

	it("renders bold border with correct characters", () => {
		const screen = new Screen(4, 3);
		const output = new Output(screen);
		renderBorder(output, 0, 0, 4, 3, "bold", {});
		output.flush();

		assert.strictEqual(screen.getCell(0, 0).char, "\u250f"); // ┏
		assert.strictEqual(screen.getCell(3, 0).char, "\u2513"); // ┓
		assert.strictEqual(screen.getCell(1, 0).char, "\u2501"); // ━
		assert.strictEqual(screen.getCell(0, 1).char, "\u2503"); // ┃
	});

	it("renders dashed border with correct characters", () => {
		const screen = new Screen(4, 3);
		const output = new Output(screen);
		renderBorder(output, 0, 0, 4, 3, "dashed", {});
		output.flush();

		// Dashed uses spaces for corners (matching CC's CUSTOM_BORDER_STYLES)
		assert.strictEqual(screen.getCell(0, 0).char, " ");
		assert.strictEqual(screen.getCell(1, 0).char, "\u254c"); // ╌
		assert.strictEqual(screen.getCell(0, 1).char, "\u254e"); // ▎
	});

	it("skips hidden sides", () => {
		const screen = new Screen(4, 3);
		const output = new Output(screen);
		renderBorder(output, 0, 0, 4, 3, "single", {
			borderTop: false,
			borderLeft: false,
		});
		output.flush();

		// No top border: (0,0) should be empty (default space)
		assert.strictEqual(screen.getCell(0, 0).char, " ");
		// No left border: (0,1) should be empty
		assert.strictEqual(screen.getCell(0, 1).char, " ");
		// Right border still present
		assert.strictEqual(screen.getCell(3, 1).char, "\u2502");
		// Bottom border still present, but its left corner is suppressed
		// because borderLeft is false — the bottom edge `─` extends to
		// column 0 instead of `└`.
		assert.strictEqual(screen.getCell(0, 2).char, "\u2500"); // ─
	});

	it("applies border color via styleId", () => {
		const screen = new Screen(4, 3);
		const output = new Output(screen);
		renderBorder(output, 0, 0, 4, 3, "single", {
			borderColor: "ansi:red",
		});
		output.flush();

		// The border characters should have a non-zero styleId
		// (the interned style with color: ansi:red).
		const cornerStyleId = screen.getCell(0, 0).styleId;
		assert.notStrictEqual(cornerStyleId, 0);

		// Verify the stylePool resolves back to the expected style.
		const style = screen.stylePool.get(cornerStyleId);
		assert.strictEqual(style?.color, "ansi:red");
	});

	it("exports all 5 BORDER_STYLES", () => {
		const styles = Object.keys(BORDER_STYLES);
		assert.ok(styles.includes("round"));
		assert.ok(styles.includes("single"));
		assert.ok(styles.includes("double"));
		assert.ok(styles.includes("dashed"));
		assert.ok(styles.includes("bold"));
		assert.strictEqual(styles.length, 5);
	});
});

// --
// colorize tests

describe("colorize", () => {
	it("converts rgb() to fg ANSI escape", () => {
		assert.strictEqual(colorizeFg("rgb(255,0,0)"), "\x1b[38;2;255;0;0m");
		assert.strictEqual(colorizeFg("rgb(0,128,255)"), "\x1b[38;2;0;128;255m");
	});

	it("converts rgb() to bg ANSI escape", () => {
		assert.strictEqual(colorizeBg("rgb(255,0,0)"), "\x1b[48;2;255;0;0m");
	});

	it("converts #RRGGBB hex to ANSI escape", () => {
		assert.strictEqual(colorizeFg("#ff0000"), "\x1b[38;2;255;0;0m");
		assert.strictEqual(colorizeFg("#00ff00"), "\x1b[38;2;0;255;0m");
		assert.strictEqual(colorizeBg("#0000ff"), "\x1b[48;2;0;0;255m");
	});

	it("expands #RGB shorthand to #RRGGBB", () => {
		assert.strictEqual(colorizeFg("#f00"), "\x1b[38;2;255;0;0m");
		assert.strictEqual(colorizeFg("#0f0"), "\x1b[38;2;0;255;0m");
		assert.strictEqual(colorizeFg("#00f"), "\x1b[38;2;0;0;255m");
	});

	it("converts ansi256() to ANSI escape", () => {
		assert.strictEqual(colorizeFg("ansi256(196)"), "\x1b[38;5;196m");
		assert.strictEqual(colorizeBg("ansi256(21)"), "\x1b[48;5;21m");
	});

	it("converts ansi: normal colors to fg SGR", () => {
		assert.strictEqual(colorizeFg("ansi:black"), "\x1b[30m");
		assert.strictEqual(colorizeFg("ansi:red"), "\x1b[31m");
		assert.strictEqual(colorizeFg("ansi:green"), "\x1b[32m");
		assert.strictEqual(colorizeFg("ansi:yellow"), "\x1b[33m");
		assert.strictEqual(colorizeFg("ansi:blue"), "\x1b[34m");
		assert.strictEqual(colorizeFg("ansi:magenta"), "\x1b[35m");
		assert.strictEqual(colorizeFg("ansi:cyan"), "\x1b[36m");
		assert.strictEqual(colorizeFg("ansi:white"), "\x1b[37m");
	});

	it("converts ansi: bright colors to fg SGR", () => {
		assert.strictEqual(colorizeFg("ansi:blackBright"), "\x1b[90m");
		assert.strictEqual(colorizeFg("ansi:redBright"), "\x1b[91m");
		assert.strictEqual(colorizeFg("ansi:greenBright"), "\x1b[92m");
		assert.strictEqual(colorizeFg("ansi:whiteBright"), "\x1b[97m");
	});

	it("converts ansi: normal colors to bg SGR", () => {
		assert.strictEqual(colorizeBg("ansi:red"), "\x1b[41m");
		assert.strictEqual(colorizeBg("ansi:blue"), "\x1b[44m");
	});

	it("converts ansi: bright colors to bg SGR", () => {
		assert.strictEqual(colorizeBg("ansi:redBright"), "\x1b[101m");
		assert.strictEqual(colorizeBg("ansi:whiteBright"), "\x1b[107m");
	});

	it("colorizeReset returns \\x1b[0m", () => {
		assert.strictEqual(colorizeReset(), "\x1b[0m");
	});

	it("applyTextStyles composes full SGR sequence", () => {
		const s = applyTextStyles({ color: "ansi:red", bold: true });
		assert.strictEqual(s, "\x1b[1m\x1b[31m");
	});

	it("applyTextStyles with background color", () => {
		const s = applyTextStyles({ backgroundColor: "ansi:blue", italic: true });
		assert.strictEqual(s, "\x1b[3m\x1b[44m");
	});

	it("applyTextStyles with all modifiers", () => {
		const s = applyTextStyles({
			bold: true,
			dim: true,
			italic: true,
			underline: true,
			strikethrough: true,
			inverse: true,
		});
		assert.strictEqual(s, "\x1b[1m\x1b[2m\x1b[3m\x1b[4m\x1b[9m\x1b[7m");
	});

	it("applyTextStyles with empty style returns empty string", () => {
		assert.strictEqual(applyTextStyles({}), "");
	});

	it("returns empty string for unrecognized color formats", () => {
		// The Color type prevents invalid strings at compile time, but
		// the parser should handle them gracefully at runtime.
		assert.strictEqual(colorizeFg("unknown" as never), "");
	});
});

// --
// wrap-text tests

describe("wrap-text", () => {
	it("wraps text to the given width", () => {
		const lines = wrapText("Hello World Foo Bar", 10, "wrap");
		assert.ok(lines.length >= 2);
		// Each line should be within the width
		for (const line of lines) {
			assert.ok(line.length <= 10 || line.includes("\x1b"));
		}
	});

	it("wraps a short string to a single line", () => {
		const lines = wrapText("Hi", 10, "wrap");
		assert.strictEqual(lines.length, 1);
		assert.strictEqual(lines[0], "Hi");
	});

	it("truncates at end with ellipsis", () => {
		const lines = wrapText("Hello World", 5, "truncate");
		assert.strictEqual(lines.length, 1);
		assert.strictEqual(lines[0], "Hell\u2026");
	});

	it("truncate-end produces same result as truncate", () => {
		const a = wrapText("Hello World", 5, "truncate-end");
		const b = wrapText("Hello World", 5, "end");
		assert.strictEqual(a[0], b[0]);
	});

	it("truncates in the middle", () => {
		const lines = wrapText("ABCDEFGH", 5, "truncate-middle");
		assert.strictEqual(lines.length, 1);
		// width=5: half=2, first=AB, last=1 char, ellipsis
		// AB + … + H = 4 visible chars... wait: half=floor(5/2)=2
		// first = 2 chars, last = 5-2-1 = 2 chars
		// AB + … + GH
		assert.strictEqual(lines[0], "AB\u2026GH");
	});

	it("truncates at start", () => {
		const lines = wrapText("ABCDEFGH", 5, "truncate-start");
		assert.strictEqual(lines.length, 1);
		// … + last 4 chars = …DEFGH -> wait: width=5, last = 5-1=4
		// …DEFGH? No: … + last(width-1) chars = … + DEFGH? width-1=4
		// … + EFGH (last 4 chars of ABCDEFGH)
		assert.strictEqual(lines[0], "\u2026EFGH");
	});

	it("returns text as-is when it fits", () => {
		const lines = wrapText("Hi", 10, "truncate");
		assert.strictEqual(lines[0], "Hi");
	});

	it("defaults to wrap mode", () => {
		const lines1 = wrapText("Hello World Foo", 5, undefined);
		const lines2 = wrapText("Hello World Foo", 5, "wrap");
		assert.deepStrictEqual(lines1, lines2);
	});
});

// --
// squash-text tests

describe("squash-text", () => {
	it("returns a single segment for a leaf ink-text", () => {
		const root = createNode("ink-root");
		const text = createNode("ink-text", { color: "ansi:red" });
		setTextContent(text, "Hello");
		appendChild(root, text);

		const segments = squashText(text);
		assert.strictEqual(segments.length, 1);
		assert.strictEqual(segments[0]!.text, "Hello");
		assert.strictEqual(segments[0]!.style.color, "ansi:red");
	});

	it("inherits styles from parent ink-box", () => {
		const root = createNode("ink-root");
		const box = createNode("ink-box", { color: "ansi:blue", bold: true });
		const text = createNode("ink-text");
		setTextContent(text, "Nested");
		appendChild(box, text);
		appendChild(root, box);

		const segments = squashText(text, { color: "ansi:blue", bold: true });
		assert.strictEqual(segments.length, 1);
		assert.strictEqual(segments[0]!.text, "Nested");
		assert.strictEqual(segments[0]!.style.color, "ansi:blue");
		assert.strictEqual(segments[0]!.style.bold, true);
	});

	it("ink-text overrides inherited styles", () => {
		const root = createNode("ink-root");
		const box = createNode("ink-box", { color: "ansi:blue" });
		const text = createNode("ink-text", { color: "ansi:red" });
		setTextContent(text, "Override");
		appendChild(box, text);
		appendChild(root, box);

		const segments = squashText(text, { color: "ansi:blue" });
		assert.strictEqual(segments[0]!.style.color, "ansi:red");
	});

	it("ink-virtual-text does not contribute styles", () => {
		const root = createNode("ink-root");
		const text = createNode("ink-text", { color: "ansi:red" });
		const vtext = createNode("ink-virtual-text");
		setTextContent(vtext, "virtual");
		appendChild(text, vtext);
		appendChild(root, text);

		const segments = squashText(text, {});
		assert.strictEqual(segments.length, 1);
		assert.strictEqual(segments[0]!.text, "virtual");
		// ink-virtual-text passes through inherited style (ansi:red from parent ink-text)
		assert.strictEqual(segments[0]!.style.color, "ansi:red");
	});

	it("returns empty array for empty text", () => {
		const root = createNode("ink-root");
		const text = createNode("ink-text");
		setTextContent(text, "");
		appendChild(root, text);

		const segments = squashText(text);
		assert.strictEqual(segments.length, 0);
	});
});

// --
// render-node tests

describe("render-node: full pipeline", () => {
	it("renders a bordered box with round style", () => {
		const root = createNode("ink-root", { flexDirection: "column" });
		const box = createNode("ink-box", {
			borderStyle: "round",
			width: 8,
			height: 3,
		});
		appendChild(root, box);

		const screen = paintTree(root, 20, 10);

		// The box is at (0,0) with width=8, height=3.
		// Top:    ╭──────╮
		// Middle: │      │
		// Bottom: ╰──────╯
		assert.strictEqual(screen.getCell(0, 0).char, "\u256d"); // ╭
		assert.strictEqual(screen.getCell(7, 0).char, "\u256e"); // ╮
		assert.strictEqual(screen.getCell(0, 2).char, "\u2570"); // ╰
		assert.strictEqual(screen.getCell(7, 2).char, "\u256f"); // ╯
		assert.strictEqual(screen.getCell(1, 0).char, "\u2500"); // ─
		assert.strictEqual(screen.getCell(0, 1).char, "\u2502"); // │
		assert.strictEqual(screen.getCell(7, 1).char, "\u2502"); // │
	});

	it("renders background color fill", () => {
		const root = createNode("ink-root", { flexDirection: "column" });
		const box = createNode("ink-box", {
			backgroundColor: "ansi:blue",
			width: 4,
			height: 2,
		});
		appendChild(root, box);

		const screen = paintTree(root, 10, 5);

		// All cells in the box area should have a styleId whose style
		// has backgroundColor = ansi:blue.
		for (let y = 0; y < 2; y++) {
			for (let x = 0; x < 4; x++) {
				const cell = screen.getCell(x, y);
				const style = screen.stylePool.get(cell.styleId);
				assert.strictEqual(style?.backgroundColor, "ansi:blue", `cell (${x},${y})`);
			}
		}
	});

	it("renders text with wrapping", () => {
		const root = createNode("ink-root", { flexDirection: "column" });
		const text = createNode("ink-text", { textWrap: "wrap" });
		setTextContent(text, "Hello World");
		appendChild(root, text);

		const screen = paintTree(root, 5, 5);

		// "Hello World" wrapped at width 5 should produce at least 2 lines.
		// Line 1: "Hello"
		// Line 2: "World"
		const line0 =
			screen.getCell(0, 0).char +
			screen.getCell(1, 0).char +
			screen.getCell(2, 0).char +
			screen.getCell(3, 0).char +
			screen.getCell(4, 0).char;
		assert.strictEqual(line0, "Hello");

		const line1 =
			screen.getCell(0, 1).char +
			screen.getCell(1, 1).char +
			screen.getCell(2, 1).char +
			screen.getCell(3, 1).char +
			screen.getCell(4, 1).char;
		assert.strictEqual(line1, "World");
	});

	it("renders text with truncate-end", () => {
		const root = createNode("ink-root", { flexDirection: "column" });
		const text = createNode("ink-text", { textWrap: "truncate-end" });
		setTextContent(text, "Hello World");
		appendChild(root, text);

		const screen = paintTree(root, 5, 3);

		// "Hello World" truncated at width 5: "Hell…"
		const line0 =
			screen.getCell(0, 0).char +
			screen.getCell(1, 0).char +
			screen.getCell(2, 0).char +
			screen.getCell(3, 0).char +
			screen.getCell(4, 0).char;
		assert.strictEqual(line0, "Hell\u2026");
	});

	it("inherits color from parent box", () => {
		const root = createNode("ink-root", { flexDirection: "column" });
		const box = createNode("ink-box", { color: "ansi:red" });
		const text = createNode("ink-text");
		setTextContent(text, "Hi");
		appendChild(box, text);
		appendChild(root, box);

		const screen = paintTree(root, 10, 5);

		// The text cells should have a styleId whose style has color=ansi:red.
		const cell = screen.getCell(0, 0);
		const style = screen.stylePool.get(cell.styleId);
		assert.strictEqual(style?.color, "ansi:red");
	});

	it("renders nested boxes with border and text", () => {
		const root = createNode("ink-root", { flexDirection: "column" });
		const outer = createNode("ink-box", {
			borderStyle: "single",
			width: 10,
			height: 5,
			paddingLeft: 1,
			paddingRight: 1,
		});
		const inner = createNode("ink-text");
		setTextContent(inner, "Hi");
		appendChild(outer, inner);
		appendChild(root, outer);

		const screen = paintTree(root, 20, 10);

		// Outer border: (0,0) = ┌, (9,0) = ┐
		assert.strictEqual(screen.getCell(0, 0).char, "\u250c"); // ┌
		assert.strictEqual(screen.getCell(9, 0).char, "\u2510"); // ┐

		// Text "Hi" is at content area: x=1(border)+1(padding)=2, y=1(border)
		assert.strictEqual(screen.getCell(2, 1).char, "H");
		assert.strictEqual(screen.getCell(3, 1).char, "i");
	});

	it("skips display:none nodes", () => {
		const root = createNode("ink-root", { flexDirection: "column" });
		const box = createNode("ink-box", { display: "none" });
		const text = createNode("ink-text");
		setTextContent(text, "Hidden");
		appendChild(box, text);
		appendChild(root, box);

		const screen = paintTree(root, 10, 5);

		// Nothing should be rendered — the box is display:none.
		assert.strictEqual(screen.getCell(0, 0).char, " ");
	});

	it("renders opaque fill with spaces", () => {
		const root = createNode("ink-root", { flexDirection: "column" });
		const box = createNode("ink-box", {
			opaque: true,
			width: 3,
			height: 2,
		});
		appendChild(root, box);

		const screen = paintTree(root, 10, 5);

		// All cells in the box should be spaces (filled by opaque).
		for (let y = 0; y < 2; y++) {
			for (let x = 0; x < 3; x++) {
				assert.strictEqual(screen.getCell(x, y).char, " ", `cell (${x},${y})`);
			}
		}
	});
});
