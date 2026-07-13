/**
 * Focus management for the new TuiEngine.
 *
 * Mirrors Claude Code's `src/ink/focus.ts` (FocusManager class) with
 * adaptations for Pi's DOM tree ({@link TuiElement}) and {@link Focusable}
 * component interface.
 *
 * ## State
 *
 * The manager is pure state — it tracks an `activeElement` and a
 * `focusStack` of saved states. It has no reference to the tree; callers
 * pass the root when tree walks are needed ({@link handleAutoFocus},
 * {@link focusNext}, {@link focusPrevious}). This matches CC's design:
 * the FocusManager lives on the root and any node can reach it.
 *
 * ## Component focus sync
 *
 * When focus changes, the wrapped {@link Focusable} Component's `focused`
 * field is synchronized: the old component's `focused` is set to `false`,
 * the new component's `focused` is set to `true`. Components read this
 * field to decide whether to emit {@link CURSOR_MARKER} during render.
 *
 * ## Focus stack
 *
 * {@link pushFocus} / {@link popFocus} save and restore the active
 * element. This is used by overlay-like contexts that need to temporarily
 * capture focus and restore it on close (e.g. a modal dialog pushing
 * focus, then popping it when dismissed). The stack is bounded at
 * {@link MAX_FOCUS_STACK_DEPTH} entries to prevent unbounded growth.
 *
 * ## Reference
 *
 * CC's `focus.ts` dispatches FocusEvent objects through a callback; Pi's
 * FocusManager syncs the `focused` field directly on the Component (the
 * existing pattern from `tui.ts`'s `setFocus`). The tree-walk helpers
 * (`collectFocusable`, `findFirstFocusable`) mirror CC's
 * `collectTabbable` / `walkTree` but use Pi's `isFocusable` type guard
 * instead of a `tabIndex` attribute check.
 */

import type { TuiElement } from "../dom/tree.ts";
import { isFocusable } from "../tui.ts";

// --
// Constants

/** Maximum depth of the focus stack (matches CC's MAX_FOCUS_STACK). */
const MAX_FOCUS_STACK_DEPTH = 32;

// --
// FocusManager

/**
 * Manages the active focused element and a stack of saved focus states.
 *
 * Construct one instance per TuiEngine session. The manager does not
 * schedule renders — callers ({@link TuiEngine}) are responsible for
 * calling `requestRender` after focus changes.
 */
export class FocusManager {
	/** The currently focused element, or undefined if no element has focus. */
	private activeElement: TuiElement | undefined;

	/** Stack of saved active elements for {@link pushFocus} / {@link popFocus}. */
	private focusStack: Array<{ node: TuiElement | undefined }> = [];

	/**
	 * Push the current active element onto the focus stack.
	 *
	 * Call before temporarily capturing focus (e.g. showing a modal).
	 * Pair with {@link popFocus} to restore. The stack is bounded at
	 * {@link MAX_FOCUS_STACK_DEPTH}; calls beyond the limit are no-ops.
	 */
	pushFocus(): void {
		if (this.focusStack.length >= MAX_FOCUS_STACK_DEPTH) return;
		this.focusStack.push({ node: this.activeElement });
	}

	/**
	 * Pop the focus stack and restore the saved active element.
	 *
	 * No-op if the stack is empty. Restores focus to the element that was
	 * active when {@link pushFocus} was called. If the saved element was
	 * undefined (no focus at push time), focus is cleared.
	 */
	popFocus(): void {
		const entry = this.focusStack.pop();
		if (entry === undefined) return;
		this.focus(entry.node);
	}

	/**
	 * Focus `node`, blurring the previously active element.
	 *
	 * Syncs the {@link Focusable} component's `focused` field: the old
	 * component's `focused` is set to `false`, the new component's
	 * `focused` is set to `true`. Pass `undefined` to blur without
	 * focusing a new element (equivalent to {@link blur}).
	 *
	 * Idempotent: a no-op if `node` is already the active element.
	 * Avoids a transient `focused = false → true` flip on the same
	 * component, which would otherwise trigger spurious re-renders.
	 */
	focus(node: TuiElement | undefined): void {
		// No-op if already focused on this node (avoids focused-field flip).
		if (this.activeElement === node) return;
		// Blur the old active element.
		if (this.activeElement !== undefined) {
			this.syncFocusable(this.activeElement, false);
		}
		// Focus the new node.
		this.activeElement = node;
		if (node !== undefined) {
			this.syncFocusable(node, true);
		}
	}

	/**
	 * Blur the active element. Syncs the component's `focused` field to
	 * `false` and clears `activeElement`. No-op if no element has focus.
	 */
	blur(): void {
		if (this.activeElement !== undefined) {
			this.syncFocusable(this.activeElement, false);
		}
		this.activeElement = undefined;
	}

	/** Get the currently focused element, or undefined. */
	getActiveElement(): TuiElement | undefined {
		return this.activeElement;
	}

	/** Check if `node` is the currently focused element. */
	isFocused(node: TuiElement): boolean {
		return this.activeElement === node;
	}

	/**
	 * Handle node removal: if the active element is the removed node,
	 * blur it. Also removes the node from the focus stack so stale
	 * references don't get restored by {@link popFocus}.
	 *
	 * Callers ({@link TuiEngine.removeChild}) should invoke this when
	 * a node is detached from the tree.
	 */
	handleNodeRemoved(node: TuiElement): void {
		if (this.activeElement === node) {
			this.blur();
		}
		// Clean up the focus stack: drop any entries referencing the
		// removed node so popFocus never restores focus to a detached node.
		this.focusStack = this.focusStack.filter((entry) => entry.node !== node);
	}

	/**
	 * Auto-focus: if no element currently has focus, focus the first
	 * focusable descendant of `root` in document order.
	 *
	 * Walks the tree in document order (depth-first, pre-order) and
	 * focuses the first node whose wrapped component implements
	 * {@link Focusable}. No-op if an element already has focus.
	 */
	handleAutoFocus(root: TuiElement): void {
		if (this.activeElement !== undefined) return;
		const first = this.findFirstFocusable(root);
		if (first !== undefined) {
			this.focus(first);
		}
	}

	/**
	 * Focus the next focusable element in document order (Tab behavior).
	 *
	 * Collects all focusable descendants of `root` in document order and
	 * focuses the one after the current active element, wrapping around
	 * to the first if the active element is last or not in the list.
	 * No-op if there are no focusable descendants.
	 */
	focusNext(root: TuiElement): void {
		const all = this.collectFocusable(root);
		if (all.length === 0) return;
		if (this.activeElement === undefined) {
			this.focus(all[0]!);
			return;
		}
		const idx = all.indexOf(this.activeElement);
		if (idx === -1) {
			this.focus(all[0]!);
		} else {
			this.focus(all[(idx + 1) % all.length]!);
		}
	}

	/**
	 * Focus the previous focusable element in document order (Shift+Tab).
	 *
	 * Collects all focusable descendants of `root` in document order and
	 * focuses the one before the current active element, wrapping around
	 * to the last if the active element is first or not in the list.
	 * No-op if there are no focusable descendants.
	 */
	focusPrevious(root: TuiElement): void {
		const all = this.collectFocusable(root);
		if (all.length === 0) return;
		if (this.activeElement === undefined) {
			this.focus(all[all.length - 1]!);
			return;
		}
		const idx = all.indexOf(this.activeElement);
		if (idx === -1) {
			this.focus(all[all.length - 1]!);
		} else {
			this.focus(all[(idx - 1 + all.length) % all.length]!);
		}
	}

	// --
	// Internal helpers

	/**
	 * Find the first focusable descendant of `node` in document order.
	 * A node is focusable if it has a `component` that implements
	 * {@link Focusable} (detected via {@link isFocusable}).
	 */
	private findFirstFocusable(node: TuiElement): TuiElement | undefined {
		if (node.component !== undefined && isFocusable(node.component)) {
			return node;
		}
		for (const child of node.childNodes) {
			const found = this.findFirstFocusable(child);
			if (found !== undefined) return found;
		}
		return undefined;
	}

	/**
	 * Sync the `focused` field on a wrapped {@link Focusable} component.
	 * No-op if the node has no component or the component is not Focusable.
	 */
	private syncFocusable(node: TuiElement, focused: boolean): void {
		const component = node.component;
		if (component !== undefined && isFocusable(component)) {
			component.focused = focused;
		}
	}

	/**
	 * Collect all focusable descendants of `node` in document order
	 * (depth-first, pre-order). A node is focusable if it has a
	 * `component` that implements {@link Focusable}.
	 */
	private collectFocusable(node: TuiElement): TuiElement[] {
		const result: TuiElement[] = [];
		const walk = (n: TuiElement): void => {
			if (n.component !== undefined && isFocusable(n.component)) {
				result.push(n);
			}
			for (const child of n.childNodes) {
				walk(child);
			}
		};
		walk(node);
		return result;
	}
}
