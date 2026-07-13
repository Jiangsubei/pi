/**
 * Animation frame loop — `requestAnimationFrame` equivalent for Node.
 *
 * Mirrors the browser's `requestAnimationFrame` / `cancelAnimationFrame`
 * API on top of `perf_hooks.performance` + `setTimeout`. Used by
 * {@link TuiEngine.requestRender} to schedule render passes at ~60fps
 * (16ms cadence) and exposed for components that need per-frame hooks
 * (e.g. animated loaders, debounced input echo).
 *
 * ## Module singleton
 *
 * State is module-level: a single `animationFrameQueue` map and a
 * single `flushTimer`. This matches the browser, where `rAF` state
 * lives on the global. {@link TuiEngine} does not own the queue — it
 * calls {@link requestAnimationFrame} like any other consumer.
 *
 * ## Frame semantics
 *
 * - {@link requestAnimationFrame} enqueues the callback and schedules
 *   a single `setTimeout(flushQueue, 16)` for the frame (subsequent
 *   calls in the same frame reuse the same timer).
 * - When the timer fires, {@link flushQueue} drains ALL pending
 *   callbacks in `scheduledTime` order (i.e. insertion order in
 *   practice, since `performance.now()` is monotonic), passing
 *   `performance.now()` as the frame time.
 * - Callbacks added DURING a flush (e.g. a callback that itself calls
 *   `requestAnimationFrame`) are NOT executed in the same flush — they
 *   go into the next frame. This matches the browser: an rAF callback
 *   that reschedules itself lands on the next frame, not the current
 *   one. We achieve this by snapshotting entries before invoking them.
 * - {@link cancelAnimationFrame} removes a callback before it fires.
 *
 * ## Reference
 *
 * Browser spec: WHATWG HTML §8.5 "Animation frames". Pi's version is a
 * simplified Node port — no `document.visibilityState` gating, no
 * high-resolution `DOMHighResTimeStamp` contract beyond `perf_hooks`
 * precision. Adequate for terminal animation.
 */

import { performance } from "node:perf_hooks";

// --
// Constants

/**
 * Frame interval in milliseconds — ~60fps. Also doubles as the
 * render-throttle interval for {@link TuiEngine.requestRender}: a
 * second `requestRender` within 16ms of the first is coalesced.
 */
const FRAME_INTERVAL_MS = 16;

// --
// Types

/**
 * Callback invoked once per animation frame. Receives the frame's
 * `performance.now()` timestamp (milliseconds since process start).
 */
export type FrameRequestCallback = (time: number) => void;

interface AnimationFrameEntry {
	callback: FrameRequestCallback;
	scheduledTime: number;
}

// --
// Module state (singleton)

/**
 * Pending animation frame callbacks keyed by handle. A `Map` rather
 * than an array so {@link cancelAnimationFrame} is O(log n) and stable
 * across interleaved schedule/cancel.
 */
const animationFrameQueue = new Map<number, AnimationFrameEntry>();

/** Next handle to hand out. Starts at 1 so 0 can signal "no handle". */
let nextHandle = 1;

/**
 * Whether a `setTimeout(flushQueue, FRAME_INTERVAL_MS)` is already
 * pending. Multiple {@link requestAnimationFrame} calls within the same
 * frame reuse the single timer — the queue is drained in one pass.
 */
let flushScheduled = false;

// --
// Internal

/**
 * Schedule the frame flush on the event loop if one isn't already
 * pending. Idempotent — calling twice in the same frame only arms one
 * timer.
 */
function scheduleFlush(): void {
	if (flushScheduled) return;
	flushScheduled = true;
	setTimeout(flushQueue, FRAME_INTERVAL_MS);
}

/**
 * Drain the pending callback queue.
 *
 * Snapshots all entries (sorted by `scheduledTime`) and clears the
 * map before invoking any callback, so callbacks registered DURING the
 * flush (e.g. a callback that reschedules itself) are deferred to the
 * next frame rather than running re-entrantly within this one. This
 * mirrors browser behavior and prevents unbounded recursion when a
 * callback unconditionally re-arms itself.
 *
 * Public as {@link flushAnimationFrames} so tests and the engine can
 * drive the queue synchronously when needed.
 */
function flushQueue(): void {
	flushScheduled = false;
	if (animationFrameQueue.size === 0) return;
	const now = performance.now();
	const entries = Array.from(animationFrameQueue.values()).sort((a, b) => a.scheduledTime - b.scheduledTime);
	animationFrameQueue.clear();
	for (const entry of entries) {
		entry.callback(now);
	}
}

// --
// Public API

/**
 * Schedule `callback` to run on the next animation frame.
 *
 * The callback receives `performance.now()` (ms since process start)
 * as its argument, matching the browser's `FrameRequestCallback`
 * contract closely enough for terminal animation. The returned handle
 * can be passed to {@link cancelAnimationFrame} to prevent the
 * callback from firing if it hasn't run yet.
 *
 * Multiple `requestAnimationFrame` calls within the same 16ms window
 * all fire in the same frame (a single `setTimeout` flush), in
 * insertion order. Callbacks registered during a flush are deferred
 * to the next frame.
 *
 * @param callback Frame callback; receives the current `performance.now()` timestamp.
 * @returns A handle for use with {@link cancelAnimationFrame}.
 */
export function requestAnimationFrame(callback: FrameRequestCallback): number {
	const handle = nextHandle++;
	animationFrameQueue.set(handle, {
		callback,
		scheduledTime: performance.now(),
	});
	scheduleFlush();
	return handle;
}

/**
 * Cancel a previously-scheduled animation frame callback.
 *
 * No-op if `handle` has already fired or was never registered. Safe to
 * call with a stale handle (the lookup just misses).
 *
 * @param handle The handle returned by {@link requestAnimationFrame}.
 */
export function cancelAnimationFrame(handle: number): void {
	animationFrameQueue.delete(handle);
}

/**
 * Synchronously drain all pending animation frame callbacks.
 *
 * Invokes every currently-queued callback with `performance.now()`,
 * in `scheduledTime` order, and clears the queue. Callbacks added
 * during the flush are deferred to the next scheduled flush (they do
 * NOT run synchronously here, matching {@link flushQueue}'s snapshot
 * semantics).
 *
 * Exposed primarily for tests and for callers that want to drive
 * animation frames deterministically (e.g. integrated with a render
 * loop that fires on a different cadence).
 */
export function flushAnimationFrames(): void {
	flushQueue();
}

/**
 * Whether any animation frame callbacks are currently pending.
 *
 * Useful for engines that want to decide whether to keep the event
 * loop alive or to skip a render pass when there's nothing to do.
 */
export function hasPendingFrames(): boolean {
	return animationFrameQueue.size > 0;
}
