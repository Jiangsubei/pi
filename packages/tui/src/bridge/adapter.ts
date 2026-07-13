/**
 * Bridge adapter — wraps an existing {@link Component} as an `ink-legacy`
 * {@link TuiElement} so it can participate in the new Yoga-backed DOM
 * tree.
 *
 * The adapter is a thin factory: it allocates a `ink-legacy` node, stores
 * the component reference on it, and installs a measure function
 * ({@link setLegacyMeasureFunc}) so Yoga can size the node by calling
 * `component.render(width)`. The paint pass ({@link renderLegacy}) later
 * reads `node.component` to render content.
 *
 * This is the P2 escape hatch for the 12 un-migrated components
 * (box/text/editor/input/markdown/image/loader/cancellable-loader/
 * select-list/settings-list/spacer/truncated-text). Each can be
 * embedded in a Yoga tree without rewriting it as an `ink-box` /
 * `ink-text` subtree.
 *
 * The returned {@link TuiElement} carries the original component on its
 * `component` field; {@link TuiElement.legacyCursor} is populated by the
 * paint pass when the component emits a CURSOR_MARKER, for Task 19's
 * focus management.
 *
 * Reference: Claude Code uses `ink-raw-ansi` for pre-rendered ANSI
 * content (src/ink/dom.ts). Pi's components produce their output lazily
 * via `render(width)`, so `ink-legacy` wraps a live component rather
 * than a static string.
 */

import { createNode, type TuiElement } from "../dom/tree.ts";
import type { Styles } from "../dom/types.ts";
import type { Component } from "../tui.ts";
import { setLegacyMeasureFunc } from "./measure.ts";

// --
// Public API

/**
 * Wrap `component` as an `ink-legacy` DOM node with a Yoga measure
 * function installed.
 *
 * The node is detached from the tree; the caller appends it to the
 * desired parent (typically via {@link TuiEngine.appendChild}). Styles
 * passed via `style` are applied to the Yoga node immediately
 * (padding, border, etc.) and participate in layout like any other
 * node. Visual-only style fields (`color`, `bold`, ...) are inherited
 * by the rendered content during the paint pass via
 * {@link renderLegacy}'s `inheritedStyle` argument.
 *
 * @param component - The legacy {@link Component} to wrap.
 * @param style - Optional initial {@link Styles} for the wrapper node.
 * @returns A detached `ink-legacy` {@link TuiElement} with
 *   `node.component === component` and a measure function installed.
 */
export function wrapComponent(component: Component, style?: Styles): TuiElement {
	const node = createNode("ink-legacy", style);
	node.component = component;
	setLegacyMeasureFunc(node, component);
	return node;
}
