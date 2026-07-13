/**
 * P5 Task 32.5 — Renderer performance benchmark.
 *
 * Standalone Node script that measures the rendering pipeline
 * (layout + paint + diff + terminal write) on a representative DOM
 * tree. Runs 1000 renderLoop-equivalent iterations on a 200×100
 * terminal and reports total time, average frame time, throughput
 * (fps), and output bytes.
 *
 * The DOM tree is built so that only one text node changes per
 * iteration — this exercises the P5 Task 32 dirty-subtree diff
 * (collectDirtyYRanges restricts the scan to that node's y-span) and
 * the row-hash fast path (rows outside the dirty span are skipped
 * entirely).
 *
 * Run with:
 *   node packages/tui/test/benchmark/profile.ts
 */

import { performance } from "node:perf_hooks";
import { createRenderer } from "../../src/diff/renderer.ts";
import type { TuiElement } from "../../src/dom/tree.ts";
import { appendChild, createNode, setTextContent } from "../../src/dom/tree.ts";
import { VirtualTerminal } from "../virtual-terminal.ts";

// --
// Configuration

const COLS = 200;
const ROWS = 100;
const ITERATIONS = 1000;
const STATIC_LINE_COUNT = 10;

// --
// DOM tree construction

/**
 * Build a representative DOM tree:
 *
 *   ink-root (200×100, column)
 *   ├── ink-box (header, height 3, border)
 *   │   └── ink-text "=== TUI Benchmark ==="
 *   ├── ink-box (content, flexGrow 1, column, padding)
 *   │   ├── ink-text × 10  (static lines)
 *   │   └── ink-text       (counter — mutated each iteration)
 *   └── ink-box (footer, height 3, border)
 *       └── ink-text "Press Q to quit"
 *
 * Only `counterTextNode` changes each iteration; the rest stay
 * static so the dirty subtree diff can skip their rows.
 */
function buildTree(): { root: TuiElement; counterTextNode: TuiElement } {
	const root = createNode("ink-root", { width: "100%", height: "100%", flexDirection: "column" });

	// Header (3 rows, full width, single border).
	const header = createNode("ink-box", { borderStyle: "single", width: "100%", height: 3 });
	const headerText = createNode("ink-text");
	headerText.textContent = "=== TUI Benchmark === Header";
	appendChild(header, headerText);
	appendChild(root, header);

	// Content area (flex 1, column direction, 1-cell padding).
	const content = createNode("ink-box", { flexGrow: 1, flexDirection: "column", padding: 1 });
	appendChild(root, content);

	// 10 static text lines — each ~50 chars wide so the row-hash
	// fast path has real content to hash and skip.
	for (let i = 0; i < STATIC_LINE_COUNT; i++) {
		const line = createNode("ink-text");
		line.textContent = `Static line ${i + 1}: ${"x".repeat(50)}`;
		appendChild(content, line);
	}

	// Counter text node — mutated each iteration.
	const counterTextNode = createNode("ink-text");
	counterTextNode.textContent = "Counter: 0";
	appendChild(content, counterTextNode);

	// Footer (3 rows, full width, single border).
	const footer = createNode("ink-box", { borderStyle: "single", width: "100%", height: 3 });
	const footerText = createNode("ink-text");
	footerText.textContent = "Press Q to quit";
	appendChild(footer, footerText);
	appendChild(root, footer);

	return { root, counterTextNode };
}

// --
// Main

function main(): void {
	const terminal = new VirtualTerminal(COLS, ROWS);
	terminal.start(
		() => undefined,
		() => undefined,
	);
	const renderer = createRenderer();
	const { root, counterTextNode } = buildTree();

	// Warmup: one render to populate prevScreen so the first measured
	// iteration goes through the incremental diff path (not the
	// first-frame full repaint).
	setTextContent(counterTextNode, "Counter: warmup");
	renderer(root, COLS, ROWS);

	// Benchmark loop. Each iteration mutates the counter text, runs
	// the full renderer pipeline (layout + paint + diff), and writes
	// the resulting ANSI to the terminal — matching what
	// TuiEngine.renderLoop does minus the IME cursor positioning.
	let totalOutputBytes = 0;
	const start = performance.now();
	for (let i = 0; i < ITERATIONS; i++) {
		setTextContent(counterTextNode, `Counter: ${i}`);
		const output = renderer(root, COLS, ROWS);
		totalOutputBytes += output.length;
		terminal.write(output);
	}
	const totalMs = performance.now() - start;

	const avgMs = totalMs / ITERATIONS;
	const fps = 1000 / avgMs;
	const avgBytes = totalOutputBytes / ITERATIONS;

	console.log("TUI Renderer Benchmark (P5 Task 32.5)");
	console.log("======================================");
	console.log(`Terminal:           ${COLS}×${ROWS}`);
	console.log(`Iterations:         ${ITERATIONS}`);
	console.log(`Static text lines:  ${STATIC_LINE_COUNT}`);
	console.log(`Total time:         ${totalMs.toFixed(2)} ms`);
	console.log(`Avg frame time:     ${avgMs.toFixed(3)} ms`);
	console.log(`Throughput:         ${fps.toFixed(1)} fps`);
	console.log(`Total output bytes: ${totalOutputBytes}`);
	console.log(`Avg output/frame:   ${avgBytes.toFixed(0)} bytes`);

	terminal.stop();
}

main();
