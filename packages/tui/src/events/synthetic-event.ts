/**
 * Synthetic events for the TUI DOM.
 *
 * Mirrors the DOM Event / KeyboardEvent / MouseEvent model in a minimal
 * form: a base {@link SyntheticEvent} with bubbling and preventDefault,
 * plus {@link KeyboardEvent} and {@link MouseEvent} subclasses carrying
 * input-specific fields.
 *
 * Reference: Task 25 spec. The dispatcher (`./dispatcher.ts`) walks the
 * parentNode chain and invokes listeners registered on each node via
 * {@link TuiElement.addEventListener}.
 */

import type { TuiElement } from "../dom/tree.ts";

// --
// Event types

/**
 * Union of all supported event types. Mouse subtypes are listed in the
 * base union so {@link TuiElement.listeners} can key on a single map;
 * {@link MouseEvent} narrows the type at construction time.
 */
export type EventType =
	| "click"
	| "keydown"
	| "keyup"
	| "keypress"
	| "mousedown"
	| "mouseup"
	| "mousemove"
	| "mousewheel"
	| "scroll"
	| "focus"
	| "blur"
	| "input"
	| "change";

// --
// SyntheticEvent

/**
 * Base class for all TUI synthetic events. Carries the event type, the
 * original target node, the current bubbling node, and propagation /
 * default-prevention flags.
 *
 * `bubbles` and `cancelable` default to `true` so listeners can call
 * {@link stopPropagation} / {@link preventDefault} without opting in.
 */
export class SyntheticEvent {
	readonly type: EventType;
	target: TuiElement | null;
	currentTarget: TuiElement | null;
	readonly bubbles: boolean;
	readonly cancelable: boolean;
	private propagationStopped = false;
	private defaultPreventedFlag = false;
	readonly timestamp: number;

	constructor(type: EventType, target: TuiElement | null, options?: { bubbles?: boolean; cancelable?: boolean }) {
		this.type = type;
		this.target = target;
		this.currentTarget = target;
		this.bubbles = options?.bubbles ?? true;
		this.cancelable = options?.cancelable ?? true;
		this.timestamp = performance.now();
	}

	stopPropagation(): void {
		this.propagationStopped = true;
	}

	isPropagationStopped(): boolean {
		return this.propagationStopped;
	}

	preventDefault(): void {
		if (this.cancelable) {
			this.defaultPreventedFlag = true;
		}
	}

	get defaultPrevented(): boolean {
		return this.defaultPreventedFlag;
	}
}

// --
// KeyboardEvent

export interface KeyboardEventInit {
	key: string;
	code?: string;
	ctrlKey?: boolean;
	altKey?: boolean;
	shiftKey?: boolean;
	metaKey?: boolean;
	type?: "keydown" | "keyup" | "keypress";
	bubbles?: boolean;
	cancelable?: boolean;
}

/**
 * Keyboard event dispatched by {@link TuiEngine.handleInput}. Carries the
 * parsed key name and modifier flags. `code` defaults to `key` since
 * terminals do not report a physical key code separate from the logical
 * key.
 */
export class KeyboardEvent extends SyntheticEvent {
	readonly key: string;
	readonly code: string;
	readonly ctrlKey: boolean;
	readonly altKey: boolean;
	readonly shiftKey: boolean;
	readonly metaKey: boolean;

	constructor(target: TuiElement, init: KeyboardEventInit) {
		super(init.type ?? "keydown", target, {
			bubbles: init.bubbles,
			cancelable: init.cancelable,
		});
		this.key = init.key;
		this.code = init.code ?? init.key;
		this.ctrlKey = init.ctrlKey ?? false;
		this.altKey = init.altKey ?? false;
		this.shiftKey = init.shiftKey ?? false;
		this.metaKey = init.metaKey ?? false;
	}
}

// --
// MouseEvent

export interface MouseEventInit {
	col: number;
	row: number;
	button?: number;
	shiftKey?: boolean;
	altKey?: boolean;
	ctrlKey?: boolean;
	metaKey?: boolean;
	type?: "mousedown" | "mouseup" | "mousemove" | "mousewheel" | "click";
	deltaY?: number;
	bubbles?: boolean;
	cancelable?: boolean;
}

/**
 * Mouse event for terminal mouse reports (P4 Task 27). Carries the
 * column/row in terminal coordinates and the modifier flags. Declared
 * now so the dispatcher and listener map can reference it without a
 * forward declaration later.
 */
export class MouseEvent extends SyntheticEvent {
	readonly col: number;
	readonly row: number;
	readonly button: number;
	readonly shiftKey: boolean;
	readonly altKey: boolean;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly deltaY: number;

	constructor(target: TuiElement | null, init: MouseEventInit) {
		super(init.type ?? "mousedown", target, {
			bubbles: init.bubbles,
			cancelable: init.cancelable,
		});
		this.col = init.col;
		this.row = init.row;
		this.button = init.button ?? 0;
		this.shiftKey = init.shiftKey ?? false;
		this.altKey = init.altKey ?? false;
		this.ctrlKey = init.ctrlKey ?? false;
		this.metaKey = init.metaKey ?? false;
		this.deltaY = init.deltaY ?? 0;
	}
}

// --
// EventListener

export type EventListener = (event: SyntheticEvent) => void;
