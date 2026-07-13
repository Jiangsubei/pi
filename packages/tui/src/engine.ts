/**
 * TuiEngine — main entry point for the new Yoga-backed TUI engine.
 *
 * Owns the root DOM node, a renderer, and a nextTick-scheduled render
 * loop. This is the P0 simplified version: no input handling, no overlay
 * stack, no render throttling. Callers build the tree imperatively via
 * {@link TuiEngine.createElement} / {@link TuiEngine.appendChild} and
 * every mutation schedules a single render pass on the next tick.
 *
 * The terminal lifecycle (stdin raw mode, resize wiring, keyboard
 * protocol negotiation) is owned by the caller, not by TuiEngine. The
 * caller starts the terminal with `terminal.start(onInput, onResize)`
 * and is expected to wire the `onResize` callback to
 * {@link TuiEngine.requestRender} so terminal resizes trigger a
 * re-layout. TuiEngine itself does not register a separate resize
 * listener because the {@link Terminal} interface has no `onResize`
 * registration method — resize is a parameter of `start()`.
 *
 * Reference: the legacy `TUI` class in `./tui.ts` (1700+ lines,
 * differential rendering, overlays, focus management) is the
 * predecessor; TuiEngine is the smaller Yoga-based replacement.
 */

import { wrapComponent } from "./bridge/adapter.ts";
import { createScrollBox, type ScrollBoxElement } from "./components-new/scroll-box.ts";
import { computeLegacyOverflowOffset, createRenderer, type Renderer } from "./diff/renderer.ts";
import type { TuiElement } from "./dom/tree.ts";
import { appendChild, createNode, insertBefore, removeChild } from "./dom/tree.ts";
import type { NodeName, Styles } from "./dom/types.ts";
import { requestAnimationFrame } from "./engine/animation.ts";
import { FocusManager } from "./engine/focus.ts";
import { type NewOverlayHandle, OverlayManager } from "./engine/overlay.ts";
import { dispatchEvent } from "./events/dispatcher.ts";
import { hitTest } from "./events/hit-test.ts";
import { parseMouseSequence } from "./events/parse-mouse.ts";
import { KeyboardEvent, MouseEvent } from "./events/synthetic-event.ts";
import type { HighlightBuilder, HighlightPredicate } from "./highlight.ts";
import { parseKey } from "./keys.ts";
import { LayoutEdge } from "./layout/node.ts";
import { hasPendingScrollDrain } from "./output/render-node.ts";
import type { Screen } from "./screen/screen.ts";
import { SearchHighlight } from "./search-highlight.ts";
import { SelectionManager } from "./selection.ts";
import type { Terminal } from "./terminal.ts";
import { deleteKittyImage } from "./terminal-image.ts";
import type { Component, OverlayOptions } from "./tui.ts";

// --
// TuiEngine

/**
 * Main TUI engine. Owns a DOM tree rooted at an `ink-root` node and a
 * renderer that walks the tree to produce ANSI output on each render
 * pass.
 *
 * Typical usage:
 *
 * ```ts
 * const engine = new TuiEngine(terminal);
 * engine.start();
 * const box = engine.createElement("ink-box", { flexDirection: "column" });
 * const text = engine.createText("Hello", { color: "green" });
 * engine.appendChild(box, text);
 * engine.appendChild(engine.rootNode, box);
 * ```
 *
 * Renders are coalesced: multiple mutations within the same tick
 * produce a single render pass on the next tick. Call
 * {@link requestRender} explicitly to schedule a render without
 * mutating the tree (e.g. from a resize callback).
 */
export class TuiEngine {
	private readonly terminal: Terminal;
	private readonly renderer: Renderer;
	private readonly overlayManager: OverlayManager;
	private readonly focusManager: FocusManager;

	/**
	 * The root `ink-root` node. Callers append their top-level
	 * elements here. The renderer sizes this node to the terminal
	 * dimensions on every render pass, so any width/height set on it
	 * is overwritten.
	 */
	readonly rootNode: TuiElement;

	private renderScheduled = false;
	private running = false;
	private lastMouseDownTarget: TuiElement | null = null;

	/**
	 * Text selection manager (Task 28). Null before {@link start} and
	 * after {@link stop}. Tracks a rectangular drag selection and emits
	 * OSC 52 clipboard copies on release.
	 */
	private selectionManager: SelectionManager | null = null;

	/**
	 * Search highlighter (Task 29). Always present; inactive when the
	 * query is empty. Composed with the selection predicate during
	 * render via logical OR.
	 */
	private searchHighlight: SearchHighlight = new SearchHighlight();

	/**
	 * Optional callback invoked by {@link handleInput} when a key event
	 * was dispatched but no listener called `preventDefault`. Callers
	 * (e.g. the TUI class) can set this to fall back to the keybinding
	 * system for unhandled keys.
	 */
	onUnhandledKey: ((data: string) => void) | undefined;

	/**
	 * Kitty graphics image IDs that were present in the previous render
	 * pass. Used by {@link emitKittyImages} to detect which images are
	 * no longer rendered and should be deleted via `deleteKittyImage`.
	 *
	 * P5 Task 34.5: the legacy TUI tracks Kitty image IDs in
	 * `previousKittyImageIds` and deletes stale ones during diff. The
	 * new engine's cell-based Screen diff has no concept of image
	 * sequences (they are stripped by {@link renderLegacy} and stored
	 * on {@link TuiElement.legacyKittyImages}), so ID tracking and
	 * deletion happens here in the renderLoop, after the diff output
	 * is written to the terminal.
	 */
	private previousKittyImageIds: Set<number> = new Set();

	/**
	 * Last-known screen positions of Kitty image IDs. Used to detect
	 * when an image with the same ID has moved between frames, so the
	 * old image can be deleted and the new one emitted at the new
	 * position. Keyed by image ID.
	 */
	private previousKittyImagePositions: Map<number, { row: number; col: number }> = new Map();

	constructor(terminal: Terminal) {
		this.terminal = terminal;
		this.rootNode = createNode("ink-root", {
			flexDirection: "column",
			width: "100%",
			height: "100%",
		});
		this.renderer = createRenderer();
		this.overlayManager = new OverlayManager(this.rootNode, terminal);
		this.focusManager = new FocusManager();
	}

	// --
	// Lifecycle

	/**
	 * Start the engine. Flips the running flag, enables SGR mouse
	 * reporting on the terminal, and schedules the first render pass.
	 * The caller is responsible for starting the terminal (raw mode,
	 * stdin, resize handling) and wiring resize events to
	 * {@link requestRender}.
	 *
	 * Idempotent: a no-op if already running. Prevents leaking a
	 * previous {@link SelectionManager} and re-enabling mouse mode
	 * when called twice (e.g. via `TUI.start()` after `TUI.stop()`).
	 */
	start(): void {
		if (this.running) return;
		this.running = true;
		this.terminal.enableMouseMode();
		this.selectionManager = new SelectionManager(this.terminal);
		this.requestRender();
	}

	/** Whether {@link start} has been called and {@link stop} has not. */
	isRunning(): boolean {
		return this.running;
	}

	/**
	 * Stop the engine. Subsequent {@link requestRender} calls are
	 * no-ops and any render scheduled for the next tick is skipped.
	 * Disables SGR mouse reporting so the terminal is restored. The
	 * terminal itself is not fully stopped — the caller owns its
	 * lifecycle.
	 */
	stop(): void {
		this.running = false;
		this.terminal.disableMouseMode();
		this.lastMouseDownTarget = null;
		if (this.selectionManager !== null) {
			this.selectionManager.endSelection();
			this.selectionManager = null;
		}
		this.searchHighlight.clear();
	}

	// --
	// DOM construction

	/**
	 * Create a new element with the given tag name and optional initial
	 * style. A fresh Yoga layout node is allocated and attached. The
	 * element is not attached to the tree; use {@link appendChild} to
	 * insert it.
	 */
	createElement(nodeName: NodeName, style?: Styles): TuiElement {
		return createNode(nodeName, style);
	}

	/**
	 * Create a text element holding `text`. Equivalent to
	 * `createElement("ink-text", style)` followed by setting
	 * `textContent`, but does not schedule a render (the element is
	 * not yet attached to the tree).
	 */
	createText(text: string, style?: Styles): TuiElement {
		const element = this.createElement("ink-text", style);
		element.textContent = text;
		return element;
	}

	/**
	 * Wrap an existing legacy {@link Component} as an `ink-legacy` DOM
	 * node. The component's `render(width)` is called during Yoga's
	 * measure pass (to size the node) and during the paint pass (to
	 * produce content), so un-migrated components can be embedded in
	 * the new Yoga-backed tree without rewriting them as `ink-box` /
	 * `ink-text` subtrees.
	 *
	 * The returned node is detached; use {@link appendChild} to insert
	 * it. Styles passed via `style` participate in layout (padding,
	 * border, …) and visual-only fields (`color`, `bold`, …) inherit to
	 * the rendered content. {@link TuiElement.legacyCursor} is populated
	 * by the paint pass when the component emits a CURSOR_MARKER.
	 */
	wrapComponent(component: Component, style?: Styles): TuiElement {
		return wrapComponent(component, style);
	}

	/**
	 * Create an `ink-scroll-box` element — a scroll container that
	 * virtualizes vertical scrolling. Children are painted into a
	 * temporary screen and only the `[scrollTop, scrollTop + height)`
	 * slice is blitted to the main screen on each render pass.
	 *
	 * The returned element exposes {@link ScrollBoxElement.scrollTo},
	 * {@link ScrollBoxElement.scrollBy}, and
	 * {@link ScrollBoxElement.scrollToBottom} for programmatic scroll
	 * control. Each call schedules a render via
	 * {@link requestRender} so the viewport updates on the next tick.
	 *
	 * Pass `stickyScroll: true` in `style` to keep the bottom visible
	 * when children are appended (chat-style auto-follow).
	 */
	createScrollBox(style?: Styles): ScrollBoxElement {
		return createScrollBox(style, this);
	}

	// --
	// Tree mutation

	/**
	 * Append `child` to `parent` and schedule a render. The child's
	 * `parentNode` is set to `parent` and the parent is marked dirty.
	 *
	 * If `child` is already attached (to this parent or another), it is
	 * first detached and then appended — matching DOM standard
	 * `appendChild` semantics for already-attached nodes (move to end).
	 */
	appendChild(parent: TuiElement, child: TuiElement): void {
		appendChild(parent, child);
		this.requestRender();
	}

	/**
	 * Insert `child` into `parent` immediately before `referenceNode`
	 * (or at the end if `referenceNode` is `null`) and schedule a render.
	 *
	 * If `child` is already attached, it is first detached and then
	 * inserted at the new position — matching DOM `insertBefore` move
	 * semantics. Used by `TUI.syncChildrenToEngine` to keep DOM child
	 * order aligned with the legacy `children` array (including
	 * in-place reordering via `splice` / index assignment).
	 */
	insertBefore(parent: TuiElement, child: TuiElement, referenceNode: TuiElement | null): void {
		insertBefore(parent, child, referenceNode);
		this.requestRender();
	}

	/**
	 * Remove `child` from `parent` and schedule a render. If the child is
	 * not present, the underlying `removeChild` is a no-op but a render is
	 * still scheduled (harmless extra pass).
	 *
	 * Notifies the {@link FocusManager} so it can blur the active element
	 * if it was the removed `child`, and prune stale entries from the
	 * focus stack.
	 */
	removeChild(parent: TuiElement, child: TuiElement): void {
		removeChild(parent, child);
		this.focusManager.handleNodeRemoved(child);
		this.requestRender();
	}

	// --
	// Overlays

	/**
	 * Show an overlay component with the given positioning options.
	 *
	 * The overlay is wrapped as an `ink-legacy` node with
	 * `position: absolute` styles computed from `options` and appended
	 * to {@link rootNode}. z-order is determined by DOM child order
	 * (later overlays paint on top). The returned handle controls
	 * visibility and focus.
	 *
	 * Schedules a render after the overlay is appended.
	 *
	 * @param component The legacy component to display as an overlay.
	 * @param options   Positioning and sizing options (anchor, width, margin, …).
	 * @returns A handle for controlling the overlay.
	 */
	showOverlay(component: Component, options: OverlayOptions): NewOverlayHandle {
		const handle = this.overlayManager.show(component, options);
		this.requestRender();
		return handle;
	}

	// --
	// Focus management

	/**
	 * Get the engine's {@link FocusManager}. Callers can use it to push
	 * / pop focus contexts (for modal flows), inspect the active element,
	 * or check whether a node is focused.
	 */
	getFocusManager(): FocusManager {
		return this.focusManager;
	}

	/**
	 * Focus a specific node. Blurs the previously active element and syncs
	 * the wrapped {@link Focusable} component's `focused` field.
	 * Schedules a render so the cursor (if any) is repositioned.
	 */
	focusNode(node: TuiElement): void {
		this.focusManager.focus(node);
		this.requestRender();
	}

	/**
	 * Blur the active element. Syncs the component's `focused` field to
	 * `false` and clears the active element. Schedules a render so the
	 * hardware cursor is hidden.
	 */
	blurActiveElement(): void {
		this.focusManager.blur();
		this.requestRender();
	}

	/**
	 * Auto-focus the first focusable descendant of {@link rootNode} in
	 * document order. No-op if an element already has focus. Schedules
	 * a render so the cursor (if the auto-focused element emits one) is
	 * positioned.
	 */
	autoFocus(): void {
		this.focusManager.handleAutoFocus(this.rootNode);
		this.requestRender();
	}

	/**
	 * Focus the next focusable element in document order (Tab behavior).
	 * Wraps around to the first element when at the end. Schedules a
	 * render so the cursor is repositioned.
	 */
	focusNext(): void {
		this.focusManager.focusNext(this.rootNode);
		this.requestRender();
	}

	/**
	 * Focus the previous focusable element in document order
	 * (Shift+Tab behavior). Wraps around to the last element when at
	 * the start. Schedules a render so the cursor is repositioned.
	 */
	focusPrevious(): void {
		this.focusManager.focusPrevious(this.rootNode);
		this.requestRender();
	}

	// --
	// Input handling

	/**
	 * Handle a raw stdin chunk. SGR mouse sequences (starting with
	 * `\x1b[<`) are parsed into a {@link MouseEvent}, resolved to a
	 * target via {@link hitTest}, and dispatched. A `click` event is
	 * synthesized when `mouseup` follows `mousedown` on the same
	 * target. All other input is parsed as a keyboard event via
	 * {@link parseKey} and dispatched to the focused element (or
	 * {@link rootNode} when nothing has focus).
	 *
	 * If a listener calls `event.preventDefault()` on a keyboard
	 * event, the key is considered handled and {@link onUnhandledKey}
	 * is not invoked. Otherwise {@link onUnhandledKey} is called (if
	 * set) so callers can fall back to the keybinding system.
	 */
	handleInput(data: string): void {
		// SGR mouse sequence: \x1b[<button;col;rowM/m
		if (data.startsWith("\x1b[<")) {
			this.handleMouseInput(data);
			return;
		}

		const keyId = parseKey(data);
		const target = this.focusManager.getActiveElement() ?? this.rootNode;

		let key: string;
		let ctrlKey = false;
		let altKey = false;
		let shiftKey = false;
		let metaKey = false;

		if (keyId !== undefined) {
			const parts = keyId.toLowerCase().split("+");
			key = parts[parts.length - 1] ?? keyId;
			ctrlKey = parts.includes("ctrl");
			altKey = parts.includes("alt");
			shiftKey = parts.includes("shift");
			metaKey = parts.includes("super");
		} else {
			key = data;
		}

		const event = new KeyboardEvent(target, { key, ctrlKey, altKey, shiftKey, metaKey });
		const notPrevented = dispatchEvent(target, event);

		if (!notPrevented) return;
		if (this.onUnhandledKey !== undefined) {
			this.onUnhandledKey(data);
		}
	}

	// --
	// Search highlight

	/**
	 * Set the search highlight query. All cells matching the query will
	 * be highlighted (inverse style via `\x1b[7m`) on the next render
	 * pass. An empty query clears the highlight.
	 *
	 * @param query   The search string. Interpreted as a regex when
	 *                `options.regex` is true.
	 * @param options.caseSensitive  If true, matching is case-sensitive.
	 *                               Default: false.
	 * @param options.regex          If true, `query` is treated as a
	 *                               regular expression. Default: false.
	 */
	setSearchHighlight(query: string, options?: { caseSensitive?: boolean; regex?: boolean }): void {
		this.searchHighlight.setQuery(query, options);
		this.requestRender();
	}

	/**
	 * Clear the search highlight. No cells will be highlighted by search
	 * on the next render pass. No-op when no query was set.
	 */
	clearSearchHighlight(): void {
		this.searchHighlight.clear();
		this.requestRender();
	}

	/**
	 * Parse and dispatch an SGR mouse sequence. Resolves the target via
	 * {@link hitTest} against {@link rootNode}, assigns it to the event,
	 * and dispatches. A `click` event is synthesized when `mouseup`
	 * follows `mousedown` on the same target.
	 */
	private handleMouseInput(data: string): void {
		const mouseEvent = parseMouseSequence(data);
		if (mouseEvent === null) return;

		// Alt+mouse-drag text selection (Task 28). When the user holds
		// Alt and drags the mouse, enter selection mode and consume the
		// event instead of dispatching it to the DOM tree so the
		// underlying elements do not receive spurious clicks.
		const sm = this.selectionManager;
		if (sm !== null) {
			// Alt+mousedown starts a new selection.
			if (mouseEvent.altKey && mouseEvent.type === "mousedown") {
				sm.startSelection(mouseEvent.col, mouseEvent.row);
				this.requestRender();
				return;
			}
			// While in selection mode, consume all mouse events so the
			// underlying DOM tree does not receive them. mousemove with
			// Alt extends the selection; mouseup ends it and triggers
			// OSC 52 clipboard copy.
			if (sm.isInSelectionMode()) {
				if (mouseEvent.type === "mousemove" && mouseEvent.altKey) {
					sm.updateSelection(mouseEvent.col, mouseEvent.row);
					this.requestRender();
				}
				if (mouseEvent.type === "mouseup") {
					sm.endSelection();
					this.requestRender();
				}
				return;
			}
		}

		const target = hitTest(this.rootNode, mouseEvent.col, mouseEvent.row) ?? this.rootNode;
		mouseEvent.target = target;
		dispatchEvent(target, mouseEvent);

		// Auto-scroll scroll-boxes on mouse wheel. If no listener called
		// preventDefault(), find the nearest ink-scroll-box ancestor of
		// the hit-tested target and scroll it by a few lines per wheel
		// tick. This gives scroll-boxes wheel support without forcing
		// every caller to attach its own mousewheel listener.
		if (mouseEvent.type === "mousewheel" && !mouseEvent.defaultPrevented) {
			let scrollBox: TuiElement | undefined = target;
			while (scrollBox !== undefined) {
				if (scrollBox.nodeName === "ink-scroll-box") break;
				scrollBox = scrollBox.parentNode;
			}
			// Fallback: if the wheel happened outside any scroll-box (e.g. on
			// a fixed footer or editor), scroll the first root-level
			// scroll-box. This matches Claude Code's behavior where the entire
			// screen above the bottom bar is one scrollable waterfall.
			if (scrollBox === undefined) {
				scrollBox = [...this.rootNode.childNodes].find((n) => n.nodeName === "ink-scroll-box");
			}
			if (scrollBox !== undefined) {
				const delta = mouseEvent.deltaY;
				if (delta !== 0) {
					(scrollBox as ScrollBoxElement).scrollBy(delta * 3);
				}
			}
		}

		// Synthesize a click event after mouseup on the same target as
		// the preceding mousedown. Mirrors browser behavior.
		if (mouseEvent.type === "mousedown") {
			this.lastMouseDownTarget = target;
		} else if (mouseEvent.type === "mouseup") {
			if (target === this.lastMouseDownTarget && this.lastMouseDownTarget !== null) {
				const clickEvent = new MouseEvent(target, {
					button: mouseEvent.button,
					col: mouseEvent.col,
					row: mouseEvent.row,
					shiftKey: mouseEvent.shiftKey,
					altKey: mouseEvent.altKey,
					ctrlKey: mouseEvent.ctrlKey,
					metaKey: mouseEvent.metaKey,
					type: "click",
				});
				dispatchEvent(target, clickEvent);
			}
			this.lastMouseDownTarget = null;
		}
	}

	// --
	// Render control

	/**
	 * Schedule a render pass on the next animation frame. Multiple
	 * calls within the same 16ms frame are coalesced into a single
	 * render pass via the `renderScheduled` flag. No-ops if the engine
	 * is stopped or a render is already scheduled.
	 *
	 * Backed by {@link requestAnimationFrame} (a `setTimeout(16ms)`
	 * flush), so renders run at ~60fps cadence rather than on the next
	 * microtask — this naturally throttles bursts of mutations
	 * (e.g. appending many children in a loop) to one render per
	 * frame, and lets per-frame animation callbacks registered via
	 * `requestAnimationFrame` interleave deterministically with the
	 * render pass.
	 */
	requestRender(): void {
		if (this.renderScheduled || !this.running) return;
		this.renderScheduled = true;
		requestAnimationFrame(() => {
			this.renderLoop();
		});
	}

	// --
	// Internal

	/**
	 * Execute a single render pass: clear the scheduled flag, run the
	 * renderer against the root node at the current terminal size, and
	 * write the resulting ANSI to the terminal. If the engine has been
	 * stopped since the render was scheduled, the pass is skipped.
	 *
	 * After the renderer output is written, the hardware cursor is
	 * positioned for IME: if the active element emitted a
	 * {@link TuiElement.legacyCursor} during the paint pass, the
	 * terminal cursor is moved to that position and made visible;
	 * otherwise the cursor is hidden.
	 */
	private renderLoop(): void {
		this.renderScheduled = false;
		if (!this.running) {
			return;
		}
		// P5 Task 32.4: StylePool/CharPool generational GC. The pools
		// are created per-frame inside the renderer (each `new Screen`
		// allocates fresh pools), so the TuiEngine does not own a
		// long-lived pool instance to call `maybeReset()` on. The
		// `maybeReset()` method exists on the pool classes and is a
		// no-op + TODO; the actual GC call site will be wired here
		// once pools become shared across frames (deferred until cell
		// storage migrates to packed Int32Array).
		const highlightBuilder = this.buildHighlightBuilder();
		const output = this.renderer(this.rootNode, this.terminal.columns, this.terminal.rows, highlightBuilder);
		this.terminal.write(output);
		this.emitKittyImages();
		this.positionImeCursor();
		// If any scroll-box still has pending delta to drain, schedule
		// another frame so the drain continues at a smooth rate.
		if (hasPendingScrollDrain()) {
			this.requestRender();
		}
	}

	/**
	 * Build a {@link HighlightBuilder} that composes the selection and
	 * search highlight predicates. Returns `undefined` when neither is
	 * active, so the renderer can skip the per-cell predicate invocation
	 * overhead for the common case (no selection, no search).
	 *
	 * The builder also updates the {@link SelectionManager}'s screen
	 * reference each frame so {@link SelectionManager.endSelection} can
	 * read the latest cell text for OSC 52 clipboard copy.
	 */
	private buildHighlightBuilder(): HighlightBuilder | undefined {
		const sm = this.selectionManager;
		const sh = this.searchHighlight;
		const selectionAvailable = sm !== null;
		const searchActive = sh.hasQuery();
		if (!selectionAvailable && !searchActive) {
			return undefined;
		}
		return (screen: Screen): HighlightPredicate => {
			if (sm !== null) {
				sm.setScreen(screen);
			}
			const selectionPred = sm !== null ? sm.getHighlightPredicate() : () => false;
			const searchPred = sh.buildPredicate(screen);
			return (x: number, y: number): boolean => selectionPred(x, y) || searchPred(x, y);
		};
	}

	/**
	 * Position the hardware cursor for IME candidate window placement.
	 *
	 * Reads {@link TuiElement.legacyCursor} from the active focused
	 * element (set by the bridge's paint pass when the wrapped
	 * {@link Focusable} component emitted a {@link CURSOR_MARKER}) and
	 * moves the terminal cursor there. The absolute screen position is
	 * computed by walking the parent chain and accumulating Yoga
	 * `getComputedLeft` / `getComputedTop` values (Yoga returns
	 * positions relative to the parent, matching the accumulation
	 * pattern in `output/render-node.ts`), then adding the node's own
	 * border + padding to reach the content origin, and finally the
	 * `legacyCursor` row/col offset.
	 *
	 * When no active element has a cursor, the terminal cursor is hidden
	 * so it doesn't sit at a stale position from a previous frame.
	 */
	private positionImeCursor(): void {
		const active = this.focusManager.getActiveElement();
		if (active === undefined || active.legacyCursor === undefined) {
			this.terminal.write("\x1b[?25l");
			return;
		}
		// Use the focused node's rendered content origin, which accounts
		// for root overflow emulation and scroll-box scroll offsets.
		const origin = this.computeRenderedContentOrigin(active);
		const cursorX = origin.x + active.legacyCursor.col;
		const cursorY = origin.y + active.legacyCursor.row;
		// CUP (Cursor Position) is 1-indexed: \x1b[{row};{col}H.
		this.terminal.write(`\x1b[${cursorY + 1};${cursorX + 1}H`);
		this.terminal.write("\x1b[?25h");
	}

	/**
	 * Emit raw Kitty graphics sequences and delete stale images.
	 *
	 * Called by {@link renderLoop} after the diff output is written. The
	 * new engine's cell-based Screen cannot represent Kitty APC sequences
	 * (`\x1b_G...`), so the bridge paint pass ({@link renderLegacy})
	 * strips them and stores the raw lines on
	 * {@link TuiElement.legacyKittyImages}. This method walks the DOM
	 * tree to collect those entries, computes their absolute screen
	 * positions, and emits:
	 *
	 * 1. `deleteKittyImage` (`\x1b_Ga=d,d=I,i=<id>...`) for every image
	 *    ID that was present in the previous frame but is no longer
	 *    rendered (or has moved to a different position).
	 * 2. The raw Kitty APC line at the correct screen position for
	 *    images that are newly rendered or have moved since the previous
	 *    frame. Unchanged images (same ID, same position) are skipped to
	 *    avoid re-transmitting potentially large base64 payloads.
	 *
	 * P5 Task 34.5.
	 */
	private emitKittyImages(): void {
		// Collect current Kitty image entries from the DOM tree.
		const currentEntries: Array<{
			id: number;
			row: number;
			col: number;
			line: string;
		}> = [];
		const currentIds = new Set<number>();
		this.collectKittyImages(this.rootNode, currentEntries, currentIds);

		// Emit deleteKittyImage for IDs that are no longer present or
		// have moved to a different position.
		let deleteBuffer = "";
		for (const id of this.previousKittyImageIds) {
			if (!currentIds.has(id)) {
				deleteBuffer += deleteKittyImage(id);
				continue;
			}
			// ID still exists — check if its position changed.
			const prevPos = this.previousKittyImagePositions.get(id);
			const curEntry = currentEntries.find((e) => e.id === id);
			if (
				curEntry !== undefined &&
				prevPos !== undefined &&
				(prevPos.row !== curEntry.row || prevPos.col !== curEntry.col)
			) {
				deleteBuffer += deleteKittyImage(id);
			}
		}
		if (deleteBuffer.length > 0) {
			this.terminal.write(deleteBuffer);
		}

		// Emit raw Kitty lines for new or moved images. Images that are
		// unchanged (same ID, same position as the previous frame) are
		// skipped to avoid re-transmitting large payloads.
		for (const entry of currentEntries) {
			const prevPos = this.previousKittyImagePositions.get(entry.id);
			const isUnchanged = prevPos !== undefined && prevPos.row === entry.row && prevPos.col === entry.col;
			if (isUnchanged) continue;

			// Position cursor at (col, row) then emit the raw line.
			// CUP is 1-indexed: \x1b[{row};{col}H.
			this.terminal.write(`\x1b[${entry.row + 1};${entry.col + 1}H`);
			this.terminal.write(entry.line);
		}

		// Update tracking state for the next frame.
		this.previousKittyImageIds = currentIds;
		this.previousKittyImagePositions.clear();
		for (const entry of currentEntries) {
			this.previousKittyImagePositions.set(entry.id, { row: entry.row, col: entry.col });
		}
	}

	/**
	 * Walk `node` depth-first and collect every Kitty image entry from
	 * {@link TuiElement.legacyKittyImages} into `entries`. Computes the
	 * absolute screen position of each image by accumulating yoga
	 * layout positions along the parent chain and adding the node's
	 * border + padding + the image's row offset.
	 */
	private collectKittyImages(
		node: TuiElement,
		entries: Array<{ id: number; row: number; col: number; line: string }>,
		currentIds: Set<number>,
	): void {
		const kittyImages = node.legacyKittyImages;
		if (kittyImages !== undefined && kittyImages.length > 0) {
			const origin = this.computeNodeContentOrigin(node);
			for (const img of kittyImages) {
				const row = origin.y + img.row;
				const col = origin.x;
				for (const id of img.ids) {
					entries.push({ id, row, col, line: img.line });
					currentIds.add(id);
				}
			}
		}
		for (const child of node.childNodes) {
			this.collectKittyImages(child, entries, currentIds);
		}
	}

	/**
	 * Compute the absolute screen position (column, row) of a node's
	 * content origin — where the first rendered line begins.
	 *
	 * Walks the parent chain accumulating `getComputedLeft()` /
	 * `getComputedTop()` (Yoga returns positions relative to the
	 * parent), then adds the node's own border + padding. Mirrors the
	 * computation in `output/render-node.ts`'s renderNodeInternal and
	 * the original inline computation in `positionImeCursor`.
	 */
	private computeNodeContentOrigin(node: TuiElement): { x: number; y: number } {
		let absX = 0;
		let absY = 0;
		let current: TuiElement | undefined = node;
		while (current !== undefined) {
			absX += current.yogaNode.getComputedLeft();
			absY += current.yogaNode.getComputedTop();
			current = current.parentNode;
		}
		const borderLeft = node.style.borderStyle !== undefined && node.style.borderLeft !== false ? 1 : 0;
		const borderTop = node.style.borderStyle !== undefined && node.style.borderTop !== false ? 1 : 0;
		const paddingLeft = node.yogaNode.getComputedPadding(LayoutEdge.Left);
		const paddingTop = node.yogaNode.getComputedPadding(LayoutEdge.Top);
		return { x: absX + borderLeft + paddingLeft, y: absY + borderTop + paddingTop };
	}

	/**
	 * Compute the rendered screen position of a node's content origin,
	 * accounting for transforms that happen during paint but are not
	 * reflected in Yoga's computed positions.
	 *
	 * Two transforms are applied:
	 *   1. Legacy overflow/root scroll emulation: when the laid-out tree
	 *      exceeds the terminal height, the renderer shifts the whole
	 *      painted frame up by `overflowOffset` rows so the bottom stays
	 *      visible. Non-absolute-positioned nodes participate in this
	 *      shift; absolute overlays do not.
	 *   2. Scroll-box scroll offsets: each `ink-scroll-box` ancestor
	 *      translates its children by `-scrollTop` when blitting the
	 *      visible slice.
	 */
	private computeRenderedContentOrigin(node: TuiElement): { x: number; y: number } {
		const origin = this.computeNodeContentOrigin(node);

		// 1. Legacy root overflow offset.
		let isAbsolute = false;
		let current: TuiElement | undefined = node;
		while (current !== undefined) {
			if (current.style.position === "absolute") {
				isAbsolute = true;
				break;
			}
			current = current.parentNode;
		}
		if (!isAbsolute) {
			const overflowOffset = computeLegacyOverflowOffset(this.rootNode, this.terminal.rows);
			origin.y -= overflowOffset;
		}

		// 2. Scroll-box scroll offsets along the parent chain.
		current = node;
		while (current !== undefined && current !== this.rootNode) {
			const parent: TuiElement | undefined = current.parentNode;
			if (parent?.nodeName === "ink-scroll-box") {
				origin.y -= parent.scrollTop;
			}
			current = parent;
		}

		return origin;
	}
}
