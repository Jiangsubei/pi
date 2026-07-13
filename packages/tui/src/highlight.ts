/**
 * Shared highlight utilities for text selection (Task 28) and search
 * highlight (Task 29).
 *
 * Both features use the same visual strategy: invert the foreground and
 * background colors of highlighted cells. The SGR "inverse" attribute
 * (`\x1b[7m`) does exactly this at the terminal level, so the shared
 * implementation toggles the `inverse` field on a {@link TextStyles}
 * object and re-interns it via the screen's {@link StylePool}.
 *
 * The {@link HighlightPredicate} is a pure `(x, y) => boolean` function
 * that both {@link SelectionManager} and {@link SearchHighlight} produce.
 * The renderer composes them (logical OR) so a cell is highlighted if
 * either feature claims it.
 *
 * {@link applyHighlight} mutates the screen in place: for every cell
 * where the predicate returns `true`, the cell's `styleId` is replaced
 * with the inverse variant. This is done before the diff pass so the
 * diff naturally detects highlight changes between frames.
 */

import type { TextStyles } from "./dom/types.ts";
import type { Screen } from "./screen/screen.ts";

// --
// Public API

/**
 * Return a copy of `style` with the `inverse` field toggled.
 *
 * If `style.inverse` was `true` (or `undefined` → falsy), the result has
 * `inverse: true`. If it was `true`, the result has `inverse: false`.
 * Shared by selection and search highlight so both produce the same
 * visual effect.
 */
export function inverseStyle(style: TextStyles): TextStyles {
	return { ...style, inverse: !style.inverse };
}

/**
 * Predicate: should the cell at `(x, y)` be highlighted (inverse-styled)?
 *
 * Both {@link SelectionManager} and {@link SearchHighlight} produce
 * instances of this type. The renderer composes them with logical OR.
 */
export type HighlightPredicate = (x: number, y: number) => boolean;

/**
 * A factory that builds a {@link HighlightPredicate} from a {@link Screen}.
 *
 * The screen is needed because search highlighting scans the screen text
 * to find match positions. Selection highlighting is purely coordinate-
 * based but uses the same type for composability.
 *
 * Returning `undefined` signals that no highlight should be applied this
 * frame (e.g. both selection and search are inactive). This avoids the
 * per-cell predicate invocation overhead of a no-op predicate.
 */
export type HighlightBuilder = (screen: Screen) => HighlightPredicate | undefined;

/**
 * Apply `highlight` to `screen` by replacing cells where the predicate
 * returns `true` with copies that have the inverse styleId.
 *
 * For each highlighted cell:
 * 1. Resolve the cell's `styleId` to a {@link TextStyles} via the
 *    screen's {@link StylePool}.
 * 2. Toggle the `inverse` field via {@link inverseStyle}.
 * 3. Re-intern the modified style via `pool.add` → new `styleId`.
 * 4. Replace the cell with a copy carrying the new `styleId`.
 *
 * The mapping from base `styleId` to inverse `styleId` is cached per
 * screen (within a single {@link applyHighlight} call) so each unique
 * base style is only interned once.
 *
 * Mutates `screen` in place. Call before diffing so the diff pass
 * detects highlight changes between frames.
 */
export function applyHighlight(screen: Screen, highlight: HighlightPredicate): void {
	const pool = screen.stylePool;
	const inverseCache = new Map<number, number>();

	for (let y = 0; y < screen.height; y++) {
		const row = screen.cells[y];
		if (row === undefined) continue;
		for (let x = 0; x < screen.width; x++) {
			if (!highlight(x, y)) continue;
			const cell = row[x];
			if (cell === undefined || cell.width === 0) continue;

			let inverseStyleId = inverseCache.get(cell.styleId);
			if (inverseStyleId === undefined) {
				const baseStyle: TextStyles = cell.styleId === 0 ? {} : (pool.get(cell.styleId) ?? {});
				const inversed = inverseStyle(baseStyle);
				inverseStyleId = pool.add(inversed);
				inverseCache.set(cell.styleId, inverseStyleId);
			}

			row[x] = { ...cell, styleId: inverseStyleId };
		}
	}
}
