/**
 * Style → Yoga node mapping.
 *
 * Translates the layout-affecting fields of a {@link Styles} object into
 * the corresponding {@link LayoutNode} setter calls. Visual-only fields
 * (color, borderStyle, textWrap) are intentionally ignored — they are
 * read by the renderer during the paint pass and never touch Yoga.
 *
 * Each `applyXxx` function reads its slice of the style object using
 * `'prop' in style` checks (not `!== undefined`), so a property that is
 * explicitly set to `undefined` still triggers the setter. This matches
 * Claude Code's `src/ink/styles.ts` (lines 406-771) semantics.
 *
 * The unified {@link applyStyles} entry point calls all nine sub-functions
 * in a fixed order; this is what {@link TuiElement} uses on initial
 * construction and after a style merge.
 *
 * Reference: Claude Code `src/ink/styles.ts` (lines 406-771).
 */

import {
	LayoutAlign,
	LayoutDisplay,
	LayoutEdge,
	LayoutFlexDirection,
	LayoutGutter,
	LayoutJustify,
	type LayoutNode,
	LayoutOverflow,
	LayoutPositionType,
	LayoutWrap,
} from "../layout/node.ts";
import type { DimensionValue, Styles } from "./types.ts";

// --
// Position

export function applyPositionStyles(node: LayoutNode, style: Styles): void {
	if ("position" in style) {
		node.setPositionType(style.position === "absolute" ? LayoutPositionType.Absolute : LayoutPositionType.Relative);
	}
	if ("top" in style) applyPositionEdge(node, "top", style.top);
	if ("bottom" in style) applyPositionEdge(node, "bottom", style.bottom);
	if ("left" in style) applyPositionEdge(node, "left", style.left);
	if ("right" in style) applyPositionEdge(node, "right", style.right);
}

function applyPositionEdge(
	node: LayoutNode,
	edge: "top" | "bottom" | "left" | "right",
	value: DimensionValue | undefined,
): void {
	if (typeof value === "string") {
		node.setPositionPercent(edge, Number.parseInt(value, 10));
	} else if (typeof value === "number") {
		node.setPosition(edge, value);
	} else {
		node.setPosition(edge, Number.NaN);
	}
}

// --
// Overflow

export function applyOverflowStyles(node: LayoutNode, style: Styles): void {
	// Yoga's Overflow controls whether children expand the container.
	// 'hidden' and 'scroll' both prevent expansion; 'scroll' additionally
	// signals that the renderer should apply scrollTop translation.
	// overflowX/Y are render-time concerns; for layout we use the union.
	const y = style.overflowY ?? style.overflow;
	const x = style.overflowX ?? style.overflow;
	if (y === "scroll" || x === "scroll") {
		node.setOverflow(LayoutOverflow.Scroll);
	} else if (y === "hidden" || x === "hidden") {
		node.setOverflow(LayoutOverflow.Hidden);
	} else if ("overflow" in style || "overflowX" in style || "overflowY" in style) {
		node.setOverflow(LayoutOverflow.Visible);
	}
}

// --
// Margin

export function applyMarginStyles(node: LayoutNode, style: Styles): void {
	if ("margin" in style) {
		node.setMargin(LayoutEdge.All, style.margin ?? 0);
	}

	if ("marginX" in style) {
		node.setMargin(LayoutEdge.Horizontal, style.marginX ?? 0);
	}

	if ("marginY" in style) {
		node.setMargin(LayoutEdge.Vertical, style.marginY ?? 0);
	}

	if ("marginLeft" in style) {
		node.setMargin(LayoutEdge.Start, style.marginLeft ?? 0);
	}

	if ("marginRight" in style) {
		node.setMargin(LayoutEdge.End, style.marginRight ?? 0);
	}

	if ("marginTop" in style) {
		node.setMargin(LayoutEdge.Top, style.marginTop ?? 0);
	}

	if ("marginBottom" in style) {
		node.setMargin(LayoutEdge.Bottom, style.marginBottom ?? 0);
	}
}

// --
// Padding

export function applyPaddingStyles(node: LayoutNode, style: Styles): void {
	if ("padding" in style) {
		node.setPadding(LayoutEdge.All, style.padding ?? 0);
	}

	if ("paddingX" in style) {
		node.setPadding(LayoutEdge.Horizontal, style.paddingX ?? 0);
	}

	if ("paddingY" in style) {
		node.setPadding(LayoutEdge.Vertical, style.paddingY ?? 0);
	}

	if ("paddingLeft" in style) {
		node.setPadding(LayoutEdge.Left, style.paddingLeft ?? 0);
	}

	if ("paddingRight" in style) {
		node.setPadding(LayoutEdge.Right, style.paddingRight ?? 0);
	}

	if ("paddingTop" in style) {
		node.setPadding(LayoutEdge.Top, style.paddingTop ?? 0);
	}

	if ("paddingBottom" in style) {
		node.setPadding(LayoutEdge.Bottom, style.paddingBottom ?? 0);
	}
}

// --
// Flex

export function applyFlexStyles(node: LayoutNode, style: Styles): void {
	if ("flexGrow" in style) {
		node.setFlexGrow(style.flexGrow ?? 0);
	}

	if ("flexShrink" in style) {
		node.setFlexShrink(typeof style.flexShrink === "number" ? style.flexShrink : 1);
	}

	if ("flexWrap" in style) {
		if (style.flexWrap === "nowrap") {
			node.setFlexWrap(LayoutWrap.NoWrap);
		}

		if (style.flexWrap === "wrap") {
			node.setFlexWrap(LayoutWrap.Wrap);
		}

		if (style.flexWrap === "wrap-reverse") {
			node.setFlexWrap(LayoutWrap.WrapReverse);
		}
	}

	if ("flexDirection" in style) {
		if (style.flexDirection === "row") {
			node.setFlexDirection(LayoutFlexDirection.Row);
		}

		if (style.flexDirection === "row-reverse") {
			node.setFlexDirection(LayoutFlexDirection.RowReverse);
		}

		if (style.flexDirection === "column") {
			node.setFlexDirection(LayoutFlexDirection.Column);
		}

		if (style.flexDirection === "column-reverse") {
			node.setFlexDirection(LayoutFlexDirection.ColumnReverse);
		}
	}

	if ("flexBasis" in style) {
		if (typeof style.flexBasis === "number") {
			node.setFlexBasis(style.flexBasis);
		} else if (typeof style.flexBasis === "string") {
			node.setFlexBasisPercent(Number.parseInt(style.flexBasis, 10));
		} else {
			node.setFlexBasis(Number.NaN);
		}
	}

	if ("alignItems" in style) {
		if (style.alignItems === "stretch" || !style.alignItems) {
			node.setAlignItems(LayoutAlign.Stretch);
		}

		if (style.alignItems === "flex-start") {
			node.setAlignItems(LayoutAlign.FlexStart);
		}

		if (style.alignItems === "center") {
			node.setAlignItems(LayoutAlign.Center);
		}

		if (style.alignItems === "flex-end") {
			node.setAlignItems(LayoutAlign.FlexEnd);
		}
	}

	if ("alignSelf" in style) {
		if (style.alignSelf === "auto" || !style.alignSelf) {
			node.setAlignSelf(LayoutAlign.Auto);
		}

		if (style.alignSelf === "flex-start") {
			node.setAlignSelf(LayoutAlign.FlexStart);
		}

		if (style.alignSelf === "center") {
			node.setAlignSelf(LayoutAlign.Center);
		}

		if (style.alignSelf === "flex-end") {
			node.setAlignSelf(LayoutAlign.FlexEnd);
		}
	}

	if ("justifyContent" in style) {
		if (style.justifyContent === "flex-start" || !style.justifyContent) {
			node.setJustifyContent(LayoutJustify.FlexStart);
		}

		if (style.justifyContent === "center") {
			node.setJustifyContent(LayoutJustify.Center);
		}

		if (style.justifyContent === "flex-end") {
			node.setJustifyContent(LayoutJustify.FlexEnd);
		}

		if (style.justifyContent === "space-between") {
			node.setJustifyContent(LayoutJustify.SpaceBetween);
		}

		if (style.justifyContent === "space-around") {
			node.setJustifyContent(LayoutJustify.SpaceAround);
		}

		if (style.justifyContent === "space-evenly") {
			node.setJustifyContent(LayoutJustify.SpaceEvenly);
		}
	}
}

// --
// Dimensions

export function applyDimensionStyles(node: LayoutNode, style: Styles): void {
	if ("width" in style) {
		if (typeof style.width === "number") {
			node.setWidth(style.width);
		} else if (typeof style.width === "string") {
			node.setWidthPercent(Number.parseInt(style.width, 10));
		} else {
			node.setWidthAuto();
		}
	}

	if ("height" in style) {
		if (typeof style.height === "number") {
			node.setHeight(style.height);
		} else if (typeof style.height === "string") {
			node.setHeightPercent(Number.parseInt(style.height, 10));
		} else {
			node.setHeightAuto();
		}
	}

	if ("minWidth" in style) {
		if (typeof style.minWidth === "string") {
			node.setMinWidthPercent(Number.parseInt(style.minWidth, 10));
		} else {
			node.setMinWidth(style.minWidth ?? 0);
		}
	}

	if ("minHeight" in style) {
		if (typeof style.minHeight === "string") {
			node.setMinHeightPercent(Number.parseInt(style.minHeight, 10));
		} else {
			node.setMinHeight(style.minHeight ?? 0);
		}
	}

	if ("maxWidth" in style) {
		if (typeof style.maxWidth === "string") {
			node.setMaxWidthPercent(Number.parseInt(style.maxWidth, 10));
		} else {
			node.setMaxWidth(style.maxWidth ?? 0);
		}
	}

	if ("maxHeight" in style) {
		if (typeof style.maxHeight === "string") {
			node.setMaxHeightPercent(Number.parseInt(style.maxHeight, 10));
		} else {
			node.setMaxHeight(style.maxHeight ?? 0);
		}
	}
}

// --
// Display

export function applyDisplayStyles(node: LayoutNode, style: Styles): void {
	if ("display" in style) {
		node.setDisplay(style.display === "flex" ? LayoutDisplay.Flex : LayoutDisplay.None);
	}
}

// --
// Border

export function applyBorderStyles(node: LayoutNode, style: Styles, resolvedStyle?: Styles): void {
	// resolvedStyle is the full current style (already set on the DOM node).
	// style may be a diff with only changed properties. For border side props,
	// we need the resolved value because `borderStyle` in a diff may not
	// include unchanged border side values (e.g. borderTop stays false but
	// isn't in the diff).
	const resolved = resolvedStyle ?? style;

	if ("borderStyle" in style) {
		const borderWidth = style.borderStyle ? 1 : 0;

		node.setBorder(LayoutEdge.Top, resolved.borderTop !== false ? borderWidth : 0);
		node.setBorder(LayoutEdge.Bottom, resolved.borderBottom !== false ? borderWidth : 0);
		node.setBorder(LayoutEdge.Left, resolved.borderLeft !== false ? borderWidth : 0);
		node.setBorder(LayoutEdge.Right, resolved.borderRight !== false ? borderWidth : 0);
	} else {
		// Handle individual border property changes (when only borderX
		// changes without borderStyle). Skip undefined values — they mean
		// the prop was removed or never set, not that a border should be
		// enabled.
		if ("borderTop" in style && style.borderTop !== undefined) {
			node.setBorder(LayoutEdge.Top, style.borderTop === false ? 0 : 1);
		}
		if ("borderBottom" in style && style.borderBottom !== undefined) {
			node.setBorder(LayoutEdge.Bottom, style.borderBottom === false ? 0 : 1);
		}
		if ("borderLeft" in style && style.borderLeft !== undefined) {
			node.setBorder(LayoutEdge.Left, style.borderLeft === false ? 0 : 1);
		}
		if ("borderRight" in style && style.borderRight !== undefined) {
			node.setBorder(LayoutEdge.Right, style.borderRight === false ? 0 : 1);
		}
	}
}

// --
// Gap

export function applyGapStyles(node: LayoutNode, style: Styles): void {
	if ("gap" in style) {
		node.setGap(LayoutGutter.All, style.gap ?? 0);
	}

	if ("columnGap" in style) {
		node.setGap(LayoutGutter.Column, style.columnGap ?? 0);
	}

	if ("rowGap" in style) {
		node.setGap(LayoutGutter.Row, style.rowGap ?? 0);
	}
}

// --
// Unified entry point

/**
 * Apply all layout-affecting fields of `style` to `node`.
 *
 * `resolvedStyle` is the fully-merged style of the DOM node (used by
 * {@link applyBorderStyles} to read border side props that may not be in
 * the `style` diff). If omitted, `style` itself is used as the resolved
 * style — appropriate for the initial application in `createNode`.
 *
 * Re-applying is idempotent: Yoga setters overwrite the previous value.
 */
export function applyStyles(node: LayoutNode, style: Styles, resolvedStyle?: Styles): void {
	applyPositionStyles(node, style);
	applyOverflowStyles(node, style);
	applyMarginStyles(node, style);
	applyPaddingStyles(node, style);
	applyFlexStyles(node, style);
	applyDimensionStyles(node, style);
	applyDisplayStyles(node, style);
	applyBorderStyles(node, style, resolvedStyle);
	applyGapStyles(node, style);
}
