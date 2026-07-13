/**
 * SearchHighlight — highlight cells matching a search query.
 *
 * Scans the screen for occurrences of a query string (literal or regex)
 * and produces a {@link HighlightPredicate} that returns true for cells
 * inside a match. The predicate is composed with the selection
 * predicate by the renderer so both features can coexist.
 *
 * Matching strategy:
 * - For each row, cell characters are concatenated into a string.
 * - Literal mode: `String.indexOf` finds all occurrences of the query.
 * - Regex mode: `RegExp[Symbol.match]` finds all match ranges.
 * - Case-insensitive mode lowercases both the row text and the query
 *   before matching.
 *
 * Width-0 cells (wide-character trailing halves) have an empty `char`
 * and do not affect the concatenated string. They are never highlighted
 * directly — only the leading cell (width=2) is marked.
 *
 * The predicate returned by {@link buildPredicate} captures the match
 * positions at build time. Call {@link buildPredicate} again after the
 * screen content changes to refresh the matches.
 */

import type { HighlightPredicate } from "./highlight.ts";
import type { Screen } from "./screen/screen.ts";

// --
// SearchHighlight

export class SearchHighlight {
	private query = "";
	private caseSensitive = false;
	private regex = false;

	/**
	 * Set the search query and matching options. An empty query clears
	 * the highlight (equivalent to {@link clear}).
	 *
	 * @param query   The search string. Interpreted as a regex when
	 *                `options.regex` is true.
	 * @param options.caseSensitive  If true, matching is case-sensitive.
	 *                               Default: false.
	 * @param options.regex          If true, `query` is treated as a
	 *                               regular expression. Default: false.
	 */
	setQuery(query: string, options?: { caseSensitive?: boolean; regex?: boolean }): void {
		this.query = query;
		this.caseSensitive = options?.caseSensitive ?? false;
		this.regex = options?.regex ?? false;
	}

	/** Clear the query and disable highlighting. */
	clear(): void {
		this.query = "";
		this.caseSensitive = false;
		this.regex = false;
	}

	/** Whether a non-empty query is currently set. */
	hasQuery(): boolean {
		return this.query !== "";
	}

	// --
	// Predicate

	/**
	 * Scan `screen` for matches and return a {@link HighlightPredicate}
	 * that returns true for cells inside a match.
	 *
	 * The match positions are computed at call time and captured in the
	 * returned closure. Call this method again after the screen content
	 * changes to refresh the matches.
	 *
	 * Returns a predicate that always returns false when no query is set
	 * or the query is empty.
	 */
	buildPredicate(screen: Screen): HighlightPredicate {
		if (this.query === "") {
			return () => false;
		}
		const matchSet = this.computeMatchSet(screen);
		return (x: number, y: number): boolean => {
			return matchSet.has(`${x},${y}`);
		};
	}

	/**
	 * Scan `screen` for matches and return the matched positions per row.
	 *
	 * @returns Array of `{ row, cols }` entries, one per row that has at
	 *          least one match. `cols` is the sorted list of column
	 *          indices that are part of a match. Returns an empty array
	 *          when no query is set or no matches are found.
	 */
	getHighlightedRanges(screen: Screen): Array<{ row: number; cols: number[] }> {
		if (this.query === "") {
			return [];
		}
		const matchSet = this.computeMatchSet(screen);
		const rowMap = new Map<number, number[]>();
		for (const key of matchSet) {
			const commaIdx = key.indexOf(",");
			const x = Number.parseInt(key.slice(0, commaIdx), 10);
			const y = Number.parseInt(key.slice(commaIdx + 1), 10);
			let cols = rowMap.get(y);
			if (cols === undefined) {
				cols = [];
				rowMap.set(y, cols);
			}
			cols.push(x);
		}
		const result: Array<{ row: number; cols: number[] }> = [];
		for (const [row, cols] of rowMap) {
			cols.sort((a, b) => a - b);
			result.push({ row, cols });
		}
		result.sort((a, b) => a.row - b.row);
		return result;
	}

	// --
	// Internal

	/**
	 * Compute the set of matched cell positions as a Set of `"x,y"` strings.
	 *
	 * For each row, the cell characters are concatenated into a string
	 * (skipping nothing — width=0 cells contribute empty strings). The
	 * query is then matched against the row text:
	 * - Literal mode: `String.indexOf` finds all occurrences.
	 * - Regex mode: `RegExp.exec` finds all matches with their ranges.
	 *
	 * For each match at position `[start, end)` in the row text, the
	 * corresponding cell columns `[start, end)` are added to the set.
	 * Note: for wide characters (width=2), the leading cell occupies one
	 * position in the string, so the column mapping is 1:1.
	 */
	private computeMatchSet(screen: Screen): Set<string> {
		const set = new Set<string>();
		const query = this.query;
		const caseSensitive = this.caseSensitive;
		const isRegex = this.regex;

		// Build the RegExp for matching (if regex mode).
		let regex: RegExp | null = null;
		if (isRegex) {
			try {
				regex = new RegExp(query, caseSensitive ? "g" : "gi");
			} catch {
				// Invalid regex — no matches.
				return set;
			}
		}

		// For literal mode, prepare the search term.
		const searchStr = caseSensitive ? query : query.toLowerCase();

		for (let y = 0; y < screen.height; y++) {
			const row = screen.cells[y];
			if (row === undefined) continue;

			// Concatenate cell chars into the row text.
			let text = "";
			for (let x = 0; x < screen.width; x++) {
				const cell = row[x];
				if (cell === undefined) {
					text += " ";
					continue;
				}
				text += cell.char;
			}

			const matchText = caseSensitive ? text : text.toLowerCase();

			if (regex !== null) {
				// Regex mode: find all matches.
				regex.lastIndex = 0;
				let match = regex.exec(matchText);
				while (match !== null) {
					const start = match.index;
					const end = start + match[0].length;
					for (let i = start; i < end; i++) {
						set.add(`${i},${y}`);
					}
					if (match[0].length === 0) {
						// Avoid infinite loop on zero-length matches.
						regex.lastIndex++;
					}
					match = regex.exec(matchText);
				}
			} else {
				// Literal mode: find all occurrences.
				let from = 0;
				let idx = matchText.indexOf(searchStr, from);
				while (idx !== -1) {
					const end = idx + searchStr.length;
					for (let i = idx; i < end; i++) {
						set.add(`${i},${y}`);
					}
					from = idx + 1;
					idx = matchText.indexOf(searchStr, from);
				}
			}
		}

		return set;
	}
}
