/**
 * Event dispatcher — walks the parentNode chain and invokes listeners.
 *
 * Algorithm:
 *  1. Collect the bubble path from `target` up to the root via
 *     `parentNode`.
 *  2. For each node, set `event.currentTarget = node` and invoke all
 *     listeners registered for `event.type`.
 *  3. Stop after the target if `event.bubbles === false` or after any
 *     listener calls `event.stopPropagation()`.
 *  4. Return `!event.defaultPrevented` (`true` when the default behavior
 *     was not cancelled).
 *
 * Reference: Task 25 spec (SubTask 25.2).
 */

import type { TuiElement } from "../dom/tree.ts";
import type { SyntheticEvent } from "./synthetic-event.ts";

/**
 * Dispatch `event` on `target`, bubbling up the parentNode chain.
 *
 * @returns `true` when the default behavior was not prevented.
 */
export function dispatchEvent(target: TuiElement, event: SyntheticEvent): boolean {
	// Collect the bubble path (target first, root last).
	const path: TuiElement[] = [];
	let current: TuiElement | undefined | null = target;
	while (current !== undefined && current !== null) {
		path.push(current);
		current = current.parentNode;
	}

	for (let i = 0; i < path.length; i++) {
		const node = path[i]!;
		event.currentTarget = node;
		const set = node.listeners.get(event.type);
		if (set !== undefined) {
			for (const listener of set) {
				listener(event);
			}
		}
		if (event.isPropagationStopped()) break;
		// Non-bubbling events stop after the target (index 0).
		if (!event.bubbles && i === 0) break;
	}

	return !event.defaultPrevented;
}
