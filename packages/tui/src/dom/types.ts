/**
 * DOM type definitions for the TUI element tree.
 *
 * Full Styles model mirroring Claude Code's `src/ink/styles.ts` (lines
 * 1-404): every CSS-like property that maps to a Yoga layout input, plus
 * the purely visual (render-time) hints (color, border, text-wrap,
 * overflow) that the renderer reads without going through Yoga.
 *
 * Layout-affecting fields are translated to Yoga node setters by
 * `apply-styles.ts` (see {@link applyStyles}). Visual-only fields are
 * read directly by the renderer during the paint pass.
 *
 * Reference: Claude Code `src/ink/styles.ts` (771 lines, full version).
 */

import type { Edges } from "../layout/geometry.ts";

// --
// Node kinds

/**
 * Tag name of a TuiElement, mirroring Ink's reconciler node names.
 *
 * - `ink-root`: top-level element produced by the renderer root
 * - `ink-box`: container element (maps to Yoga flex container)
 * - `ink-text`: leaf element holding a `textContent` string
 * - `ink-virtual-text`: bare text node with no style of its own
 * - `ink-link`: hyperlink wrapper (renders OSC 8 hyperlinks)
 * - `ink-legacy`: escape hatch for un-migrated components
 * - `ink-scroll-box`: scroll container with virtualized scrollTop offset
 */
export type NodeName =
	| "ink-root"
	| "ink-box"
	| "ink-text"
	| "ink-virtual-text"
	| "ink-link"
	| "ink-legacy"
	| "ink-scroll-box";

// --
// Geometry helpers

/**
 * Re-exported so consumers of the DOM types don't need a second import
 * for the resolved (all-four-edges) shape. Individual edge values are
 * set on {@link Styles} via the dedicated `marginTop` / `paddingLeft` /
 * etc. fields; the resolved `Edges` tuple is only used internally by
 * the layout and renderer code.
 */
export type { Edges };

/** A number of cells, or a percentage string like `"50%"` resolved against the parent. */
export type DimensionValue = number | `${number}%`;

// --
// Colors

export type RGBColor = `rgb(${number},${number},${number})`;
export type HexColor = `#${string}`;
export type Ansi256Color = `ansi256(${number})`;
export type AnsiColor =
	| "ansi:black"
	| "ansi:red"
	| "ansi:green"
	| "ansi:yellow"
	| "ansi:blue"
	| "ansi:magenta"
	| "ansi:cyan"
	| "ansi:white"
	| "ansi:blackBright"
	| "ansi:redBright"
	| "ansi:greenBright"
	| "ansi:yellowBright"
	| "ansi:blueBright"
	| "ansi:magentaBright"
	| "ansi:cyanBright"
	| "ansi:whiteBright";

/** Raw color value - not a theme key. Theme resolution happens at the component layer. */
export type Color = RGBColor | HexColor | Ansi256Color | AnsiColor;

// --
// Text styles

/**
 * Structured text styling properties.
 *
 * Used to style text without relying on ANSI string transforms. Colors
 * are raw values - theme resolution happens at the component layer.
 * The same fields also appear on {@link Styles} directly so a `Box` can
 * set text props that inherit to its child `Text` nodes.
 */
export type TextStyles = {
	color?: Color;
	backgroundColor?: Color;
	dim?: boolean;
	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
	strikethrough?: boolean;
	inverse?: boolean;
};

// --
// Border

export type BorderStyle = "round" | "single" | "double" | "dashed" | "bold";

// TODO: replace with the real `BorderTextOptions` type once the border
// renderer is ported (CC: src/ink/render-border.ts). Using `unknown` as a
// placeholder so callers can pass any value through without touching Yoga.
export type BorderTextOptions = unknown;

// --
// Styles

/**
 * Style applied to a {@link TuiElement}. Every field is optional; unset
 * fields inherit the renderer default (not the Yoga default — the DOM
 * layer applies its own defaults when translating to Yoga inputs).
 *
 * Layout-affecting fields (`width`, `flexGrow`, `padding`, ...) are
 * translated to Yoga node setters by `apply-styles.ts`. Visual-only
 * fields (`color`, `borderStyle`, ...) are read directly by the renderer
 * during the paint pass and never touch Yoga.
 *
 * Reference: Claude Code `src/ink/styles.ts` (lines 55-404).
 */
export interface Styles {
	// -- Text layout
	readonly textWrap?:
		| "wrap"
		| "wrap-trim"
		| "end"
		| "middle"
		| "truncate-end"
		| "truncate"
		| "truncate-middle"
		| "truncate-start";

	// -- Position
	readonly position?: "absolute" | "relative";
	readonly top?: DimensionValue;
	readonly bottom?: DimensionValue;
	readonly left?: DimensionValue;
	readonly right?: DimensionValue;

	// -- Gap
	/** Size of the gap between an element's columns. */
	readonly columnGap?: number;
	/** Size of the gap between element's rows. */
	readonly rowGap?: number;
	/** Size of the gap between an element's columns and rows. Shorthand for `columnGap` and `rowGap`. */
	readonly gap?: number;

	// -- Margin
	/** Margin on all sides. Equivalent to setting `marginTop`, `marginBottom`, `marginLeft` and `marginRight`. */
	readonly margin?: number;
	/** Horizontal margin. Equivalent to setting `marginLeft` and `marginRight`. */
	readonly marginX?: number;
	/** Vertical margin. Equivalent to setting `marginTop` and `marginBottom`. */
	readonly marginY?: number;
	/** Top margin. */
	readonly marginTop?: number;
	/** Bottom margin. */
	readonly marginBottom?: number;
	/** Left margin. */
	readonly marginLeft?: number;
	/** Right margin. */
	readonly marginRight?: number;

	// -- Padding
	/** Padding on all sides. Equivalent to setting `paddingTop`, `paddingBottom`, `paddingLeft` and `paddingRight`. */
	readonly padding?: number;
	/** Horizontal padding. Equivalent to setting `paddingLeft` and `paddingRight`. */
	readonly paddingX?: number;
	/** Vertical padding. Equivalent to setting `paddingTop` and `paddingBottom`. */
	readonly paddingY?: number;
	/** Top padding. */
	readonly paddingTop?: number;
	/** Bottom padding. */
	readonly paddingBottom?: number;
	/** Left padding. */
	readonly paddingLeft?: number;
	/** Right padding. */
	readonly paddingRight?: number;

	// -- Flex
	/**
	 * This property defines the ability for a flex item to grow if necessary.
	 * See [flex-grow](https://css-tricks.com/almanac/properties/f/flex-grow/).
	 */
	readonly flexGrow?: number;
	/**
	 * It specifies the "flex shrink factor", which determines how much the flex item will shrink relative to the rest of the flex items in the flex container when there isn't enough space on the row.
	 * See [flex-shrink](https://css-tricks.com/almanac/properties/f/flex-shrink/).
	 */
	readonly flexShrink?: number;
	/**
	 * It establishes the main-axis, thus defining the direction flex items are placed in the flex container.
	 * See [flex-direction](https://css-tricks.com/almanac/properties/f/flex-direction/).
	 */
	readonly flexDirection?: "row" | "column" | "row-reverse" | "column-reverse";
	/**
	 * It specifies the initial size of the flex item, before any available space is distributed according to the flex factors.
	 * See [flex-basis](https://css-tricks.com/almanac/properties/f/flex-basis/).
	 */
	readonly flexBasis?: number | string;
	/**
	 * It defines whether the flex items are forced in a single line or can be flowed into multiple lines. If set to multiple lines, it also defines the cross-axis which determines the direction new lines are stacked in.
	 * See [flex-wrap](https://css-tricks.com/almanac/properties/f/flex-wrap/).
	 */
	readonly flexWrap?: "nowrap" | "wrap" | "wrap-reverse";

	// -- Alignment
	/**
	 * The align-items property defines the default behavior for how items are laid out along the cross axis (perpendicular to the main axis).
	 * See [align-items](https://css-tricks.com/almanac/properties/a/align-items/).
	 */
	readonly alignItems?: "flex-start" | "center" | "flex-end" | "stretch";
	/**
	 * It makes possible to override the align-items value for specific flex items.
	 * See [align-self](https://css-tricks.com/almanac/properties/a/align-self/).
	 */
	readonly alignSelf?: "flex-start" | "center" | "flex-end" | "auto";
	/**
	 * It defines the alignment along the main axis.
	 * See [justify-content](https://css-tricks.com/almanac/properties/j/justify-content/).
	 */
	readonly justifyContent?: "flex-start" | "flex-end" | "space-between" | "space-around" | "space-evenly" | "center";

	// -- Dimensions
	/**
	 * Width of the element in spaces.
	 * You can also set it in percent, which will calculate the width based on the width of parent element.
	 */
	readonly width?: number | string;
	/**
	 * Height of the element in lines (rows).
	 * You can also set it in percent, which will calculate the height based on the height of parent element.
	 */
	readonly height?: number | string;
	/** Sets a minimum width of the element. */
	readonly minWidth?: number | string;
	/** Sets a minimum height of the element. */
	readonly minHeight?: number | string;
	/** Sets a maximum width of the element. */
	readonly maxWidth?: number | string;
	/** Sets a maximum height of the element. */
	readonly maxHeight?: number | string;

	// -- Display
	/** Set this property to `none` to hide the element. */
	readonly display?: "flex" | "none";

	// -- Border (drawn by renderer; border width is 1)
	/**
	 * Add a border with a specified style.
	 * If `borderStyle` is `undefined` (which it is by default), no border will be added.
	 */
	readonly borderStyle?: BorderStyle;
	/** Determines whether top border is visible. @default true */
	readonly borderTop?: boolean;
	/** Determines whether bottom border is visible. @default true */
	readonly borderBottom?: boolean;
	/** Determines whether left border is visible. @default true */
	readonly borderLeft?: boolean;
	/** Determines whether right border is visible. @default true */
	readonly borderRight?: boolean;
	/**
	 * Change border color.
	 * Shorthand for setting `borderTopColor`, `borderRightColor`, `borderBottomColor` and `borderLeftColor`.
	 */
	readonly borderColor?: Color;
	/** Change top border color. Accepts raw color values (rgb, hex, ansi). */
	readonly borderTopColor?: Color;
	/** Change bottom border color. Accepts raw color values (rgb, hex, ansi). */
	readonly borderBottomColor?: Color;
	/** Change left border color. Accepts raw color values (rgb, hex, ansi). */
	readonly borderLeftColor?: Color;
	/** Change right border color. Accepts raw color values (rgb, hex, ansi). */
	readonly borderRightColor?: Color;
	/**
	 * Dim the border color.
	 * Shorthand for setting `borderTopDimColor`, `borderBottomDimColor`, `borderLeftDimColor` and `borderRightDimColor`.
	 * @default false
	 */
	readonly borderDimColor?: boolean;
	/** Dim the top border color. @default false */
	readonly borderTopDimColor?: boolean;
	/** Dim the bottom border color. @default false */
	readonly borderBottomDimColor?: boolean;
	/** Dim the left border color. @default false */
	readonly borderLeftDimColor?: boolean;
	/** Dim the right border color. @default false */
	readonly borderRightDimColor?: boolean;
	/** Add text within the border. Only applies to top or bottom borders. */
	readonly borderText?: BorderTextOptions;

	// -- Visual: fill (render-time only)
	/**
	 * Background color for the box. Fills the interior with background-colored
	 * spaces and is inherited by child text nodes as their default background.
	 */
	readonly backgroundColor?: Color;
	/** Foreground (text) color. */
	readonly color?: Color;
	/**
	 * Fill the box's interior (padding included) with spaces before
	 * rendering children, so nothing behind it shows through. Like
	 * `backgroundColor` but without emitting any SGR — the terminal's
	 * default background is used. Useful for absolute-positioned overlays
	 * where Box padding/gaps would otherwise be transparent.
	 */
	readonly opaque?: boolean;

	// -- Text styles (also accepted on Box so they inherit to child Text)
	readonly bold?: boolean;
	readonly dim?: boolean;
	readonly italic?: boolean;
	readonly underline?: boolean;
	readonly strikethrough?: boolean;
	readonly inverse?: boolean;

	// -- Overflow
	/**
	 * Behavior for an element's overflow in both directions.
	 * 'scroll' constrains the container's size (children do not expand it)
	 * and enables scrollTop-based virtualized scrolling at render time.
	 * @default 'visible'
	 */
	readonly overflow?: "visible" | "hidden" | "scroll";
	/** Behavior for an element's overflow in horizontal direction. @default 'visible' */
	readonly overflowX?: "visible" | "hidden" | "scroll";
	/** Behavior for an element's overflow in vertical direction. @default 'visible' */
	readonly overflowY?: "visible" | "hidden" | "scroll";

	// -- Scroll
	/**
	 * When `true`, the scroll container automatically adjusts `scrollTop`
	 * to keep the bottommost child visible when new children are appended
	 * (sticky-to-bottom behavior). Only effective on `ink-scroll-box`
	 * nodes with `overflow: "scroll"`.
	 * @default false
	 */
	readonly stickyScroll?: boolean;

	// -- Selection
	/**
	 * Exclude this box's cells from text selection in fullscreen mode.
	 * Cells inside this region are skipped by both the selection highlight
	 * and the copied text — useful for fencing off gutters (line numbers,
	 * diff sigils) so click-drag over a diff yields clean copyable code.
	 * Only affects alt-screen text selection; no-op otherwise.
	 *
	 * `'from-left-edge'` extends the exclusion from column 0 to the box's
	 * right edge for every row it occupies — this covers any upstream
	 * indentation (tool message prefix, tree lines) so a multi-row drag
	 * doesn't pick up leading whitespace from middle rows.
	 */
	readonly noSelect?: boolean | "from-left-edge";
}
