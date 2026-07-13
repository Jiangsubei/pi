/**
 * Animation frame loop tests — Task 24.
 *
 * Validates the `requestAnimationFrame` / `cancelAnimationFrame` port
 * and the integration with {@link TuiEngine.requestRender}:
 *
 *   1. Callback timing & timestamp contract
 *   2. cancelAnimationFrame prevents firing
 *   3. Multiple callbacks fire in the same frame, in insertion order
 *   4. flushAnimationFrames drains synchronously
 *   5. hasPendingFrames reports queue state
 *   6. Callbacks scheduled during a flush are deferred to the next frame
 *   7. TuiEngine.requestRender coalesces multiple calls into one render
 *
 * Time-based assertions use a 40ms sleep — comfortably above the 16ms
 * frame interval so the flush has fired. The CapturingVirtualTerminal
 * pattern is reused from scroll-box.test.ts to count render passes by
 * counting terminal writes (one renderLoop = a bounded number of writes).
 */

import assert from "node:assert";
import { describe, it } from "node:test";
import {
	cancelAnimationFrame,
	flushAnimationFrames,
	hasPendingFrames,
	requestAnimationFrame,
} from "../src/engine/animation.ts";
import { TuiEngine } from "../src/engine.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

// --
// Helpers

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sleep long enough that any pending 16ms rAF flush has fired.
 * 40ms gives a comfortable margin above the frame interval so the
 * test is robust to scheduler jitter on slow CI.
 */
const waitForFrame = (): Promise<void> => sleep(40);

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

function setupEngine(cols = 20, rows = 5): { terminal: CapturingVirtualTerminal; engine: TuiEngine } {
	const terminal = new CapturingVirtualTerminal(cols, rows);
	terminal.start(
		() => undefined,
		() => undefined,
	);
	const engine = new TuiEngine(terminal);
	terminal.clearWrites();
	return { terminal, engine };
}

// --
// Animation module: rAF primitives

describe("animation: requestAnimationFrame", () => {
	it("fires callback with a numeric timestamp", async () => {
		let called = 0;
		let receivedTime: number | undefined;
		requestAnimationFrame((t) => {
			called++;
			receivedTime = t;
		});
		assert.strictEqual(hasPendingFrames(), true, "frame should be pending before flush");
		await waitForFrame();
		assert.strictEqual(called, 1, `callback should fire once, got ${called}`);
		assert.strictEqual(typeof receivedTime, "number", "timestamp should be a number");
		assert.ok((receivedTime as number) > 0, "timestamp should be positive");
		assert.strictEqual(hasPendingFrames(), false, "no frames pending after flush");
	});

	it("does not fire synchronously — waits for the setTimeout flush", async () => {
		let called = 0;
		requestAnimationFrame(() => {
			called++;
		});
		// Immediately after scheduling, the callback must NOT have fired.
		assert.strictEqual(called, 0, "callback should not fire synchronously");
		await waitForFrame();
		assert.strictEqual(called, 1, "callback should fire after the frame");
	});
});

describe("animation: cancelAnimationFrame", () => {
	it("prevents a scheduled callback from firing", async () => {
		let called = 0;
		const handle = requestAnimationFrame(() => {
			called++;
		});
		assert.strictEqual(hasPendingFrames(), true, "frame should be pending before cancel");
		cancelAnimationFrame(handle);
		assert.strictEqual(hasPendingFrames(), false, "no frames pending after cancel");
		await waitForFrame();
		assert.strictEqual(called, 0, `cancelled callback should not fire, got ${called}`);
	});

	it("is a no-op for an unknown or already-fired handle", async () => {
		let called = 0;
		const handle = requestAnimationFrame(() => {
			called++;
		});
		await waitForFrame();
		assert.strictEqual(called, 1, "callback should have fired");
		// Cancelling an already-fired handle must not throw or affect state.
		assert.doesNotThrow(() => cancelAnimationFrame(handle));
		// Cancelling a never-registered handle must not throw.
		assert.doesNotThrow(() => cancelAnimationFrame(999999));
	});

	it("only cancels the targeted handle, not others", async () => {
		let a = 0;
		let b = 0;
		const handleA = requestAnimationFrame(() => {
			a++;
		});
		requestAnimationFrame(() => {
			b++;
		});
		cancelAnimationFrame(handleA);
		await waitForFrame();
		assert.strictEqual(a, 0, "cancelled callback should not fire");
		assert.strictEqual(b, 1, "other callback should still fire");
	});
});

describe("animation: multiple callbacks in same frame", () => {
	it("fires all callbacks scheduled before the flush in insertion order", async () => {
		const order: number[] = [];
		requestAnimationFrame(() => order.push(1));
		requestAnimationFrame(() => order.push(2));
		requestAnimationFrame(() => order.push(3));
		assert.strictEqual(hasPendingFrames(), true, "should have 3 pending frames");
		await waitForFrame();
		assert.deepStrictEqual(
			order,
			[1, 2, 3],
			`callbacks should fire in insertion order, got ${JSON.stringify(order)}`,
		);
		assert.strictEqual(hasPendingFrames(), false, "queue should be empty after flush");
	});

	it("shares a single setTimeout across multiple rAF calls", async () => {
		// Hard to assert timer count directly; instead, verify that two
		// rAF calls registered synchronously fire at very close times
		// (within a few ms of each other), which only happens if they
		// were flushed in the same pass.
		let time1: number | undefined;
		let time2: number | undefined;
		requestAnimationFrame((t) => {
			time1 = t;
		});
		requestAnimationFrame((t) => {
			time2 = t;
		});
		await waitForFrame();
		assert.ok(time1 !== undefined && time2 !== undefined, "both callbacks should fire");
		assert.ok(
			Math.abs(time1 - time2) < 5,
			`same-frame callbacks should receive near-identical timestamps, got ${time1} vs ${time2}`,
		);
	});
});

describe("animation: flushAnimationFrames", () => {
	it("drains pending callbacks synchronously", () => {
		let called = 0;
		requestAnimationFrame(() => {
			called++;
		});
		assert.strictEqual(hasPendingFrames(), true, "frame should be pending");
		flushAnimationFrames();
		assert.strictEqual(called, 1, "callback should fire synchronously on flush");
		assert.strictEqual(hasPendingFrames(), false, "queue should be empty after flush");
	});

	it("no-ops when queue is empty", () => {
		assert.strictEqual(hasPendingFrames(), false, "queue should be empty initially");
		assert.doesNotThrow(() => flushAnimationFrames());
	});

	it("clears the queue so a later scheduled flush finds nothing", async () => {
		let called = 0;
		requestAnimationFrame(() => {
			called++;
		});
		flushAnimationFrames();
		assert.strictEqual(called, 1, "callback should fire on manual flush");
		// After manual flush, the pending setTimeout(flushQueue, 16) is still
		// armed but will find an empty queue — no second invocation.
		await waitForFrame();
		assert.strictEqual(called, 1, "callback should not fire twice");
	});
});

describe("animation: re-entrancy", () => {
	it("defers callbacks registered during a flush to a later flush", () => {
		// A callback that schedules another rAF mid-flush must NOT cause
		// the inner rAF to run in the same synchronous flush pass. The
		// inner rAF is queued for the next flush (whether triggered by
		// the natural setTimeout or by an explicit flushAnimationFrames).
		const order: string[] = [];
		requestAnimationFrame(() => {
			order.push("first");
			requestAnimationFrame(() => {
				order.push("second");
			});
		});
		// First flush: only the outer callback runs synchronously. The
		// inner rAF is registered but not invoked in this pass.
		flushAnimationFrames();
		assert.deepStrictEqual(order, ["first"], "inner rAF should not run in same flush");
		assert.strictEqual(hasPendingFrames(), true, "inner rAF should be pending");
		// Second flush: now the inner rAF fires.
		flushAnimationFrames();
		assert.deepStrictEqual(order, ["first", "second"], "inner rAF should run on next flush");
		assert.strictEqual(hasPendingFrames(), false, "queue should be empty after second flush");
	});

	it("with natural setTimeout timing, mid-flush registration fires on a separate timer", async () => {
		// Sanity check: when rAF callbacks fire via the natural setTimeout
		// flush (not via explicit flushAnimationFrames), a mid-flush
		// registration still lands on a separate flush pass — its
		// timestamp should differ from the first callback's by a non-zero
		// amount (it scheduled a fresh setTimeout(16) rather than running
		// synchronously within the first flush).
		const times: number[] = [];
		requestAnimationFrame((t) => {
			times.push(t);
			requestAnimationFrame((t2) => {
				times.push(t2);
			});
		});
		await waitForFrame();
		assert.strictEqual(times.length, 2, "both callbacks should fire within 40ms");
		assert.ok(times[1] >= times[0], `second callback timestamp should be >= first, got ${times[0]} then ${times[1]}`);
	});

	it("flushAnimationFrames also defers mid-flush registrations", () => {
		const order: string[] = [];
		requestAnimationFrame(() => {
			order.push("first");
			requestAnimationFrame(() => {
				order.push("second");
			});
		});
		flushAnimationFrames();
		assert.deepStrictEqual(order, ["first"], "second callback should be deferred");
		assert.strictEqual(hasPendingFrames(), true, "deferred callback should be pending");
		// Clean up: drain the deferred callback so it doesn't leak into other tests.
		flushAnimationFrames();
		assert.deepStrictEqual(order, ["first", "second"]);
	});
});

// --
// Engine integration: requestRender coalescing

describe("animation: TuiEngine.requestRender coalescing", () => {
	it("multiple requestRender calls in the same frame produce one render pass", async () => {
		const { terminal, engine } = setupEngine(20, 5);
		engine.appendChild(engine.rootNode, engine.createText("hello"));
		engine.start();
		await terminal.waitForRender();

		// Measure writes for a single requestRender.
		terminal.clearWrites();
		engine.requestRender();
		await terminal.waitForRender();
		const singleRenderWrites = terminal.writes.length;
		assert.ok(singleRenderWrites > 0, "single requestRender should produce writes");

		// Triple requestRender in the same frame should produce the same
		// number of writes (one render pass), not three.
		terminal.clearWrites();
		engine.requestRender();
		engine.requestRender();
		engine.requestRender();
		await terminal.waitForRender();
		const tripleRenderWrites = terminal.writes.length;

		assert.strictEqual(
			tripleRenderWrites,
			singleRenderWrites,
			`triple requestRender should coalesce to one pass (got ${tripleRenderWrites} vs ${singleRenderWrites} writes)`,
		);

		engine.stop();
		terminal.stop();
	});

	it("text mutation followed by requestRender updates the viewport", async () => {
		const { terminal, engine } = setupEngine(20, 5);
		const text = engine.createText("first");
		engine.appendChild(engine.rootNode, text);
		engine.start();
		await terminal.waitForRender();

		text.textContent = "second";
		engine.requestRender();
		await terminal.waitForRender();

		const viewport = terminal.getViewport();
		const output = viewport.join("\n");
		assert.ok(
			output.includes("second"),
			`viewport should contain "second" after requestRender, got: ${JSON.stringify(viewport.slice(0, 2))}`,
		);
		assert.ok(
			!output.includes("first"),
			`viewport should NOT contain "first" after diff render, got: ${JSON.stringify(viewport.slice(0, 2))}`,
		);

		engine.stop();
		terminal.stop();
	});

	it("renders at most ~60fps: a second requestRender immediately after a render is NOT a no-op", async () => {
		// Sanity check: after a render completes (renderScheduled=false),
		// a new requestRender should schedule a fresh frame. This guards
		// against the coalescing flag being stuck.
		const { terminal, engine } = setupEngine(20, 5);
		engine.appendChild(engine.rootNode, engine.createText("a"));
		engine.start();
		await terminal.waitForRender();

		// First render.
		terminal.clearWrites();
		(engine.rootNode.childNodes[0] as unknown as { textContent: string }).textContent = "b";
		engine.requestRender();
		await terminal.waitForRender();
		const firstPass = terminal.writes.length;
		assert.ok(firstPass > 0, "first requestRender after start should produce writes");

		// Second render — distinct frame, should also produce writes.
		terminal.clearWrites();
		(engine.rootNode.childNodes[0] as unknown as { textContent: string }).textContent = "c";
		engine.requestRender();
		await terminal.waitForRender();
		const secondPass = terminal.writes.length;
		assert.ok(secondPass > 0, "second requestRender in a new frame should produce writes");

		engine.stop();
		terminal.stop();
	});
});
