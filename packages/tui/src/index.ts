// Core TUI interfaces and classes

// Autocomplete support
export {
	type AutocompleteItem,
	type AutocompleteProvider,
	type AutocompleteSuggestions,
	CombinedAutocompleteProvider,
	type SlashCommand,
} from "./autocomplete.ts";
// Bidirectional text (RTL) support
export { type BaseDirection, getBaseDirection, reorderVisual, stripBidiControls, type VisualChar } from "./bidi.ts";
export { wrapComponent } from "./bridge/adapter.ts";
// Components
export { Box } from "./components/box.ts";
export { CancellableLoader } from "./components/cancellable-loader.ts";
export { Editor, type EditorOptions, type EditorTheme } from "./components/editor.ts";
export { Image, type ImageOptions, type ImageTheme } from "./components/image.ts";
export { Input } from "./components/input.ts";
export { Loader, type LoaderIndicatorOptions } from "./components/loader.ts";
export { type DefaultTextStyle, Markdown, type MarkdownOptions, type MarkdownTheme } from "./components/markdown.ts";
export {
	type SelectItem,
	SelectList,
	type SelectListLayoutOptions,
	type SelectListTheme,
	type SelectListTruncatePrimaryContext,
} from "./components/select-list.ts";
export { type SettingItem, SettingsList, type SettingsListTheme } from "./components/settings-list.ts";
export { Spacer } from "./components/spacer.ts";
export { Text } from "./components/text.ts";
export { TruncatedText } from "./components/truncated-text.ts";
export { createApp } from "./components-new/app.ts";
export { createBox } from "./components-new/box.ts";
export { createScrollBox, type ScrollBoxElement } from "./components-new/scroll-box.ts";
export { createText } from "./components-new/text.ts";
export { LogUpdate } from "./diff/log-update.ts";
export { createRenderer, type Renderer } from "./diff/renderer.ts";
export { applyStyles } from "./dom/apply-styles.ts";
export {
	appendChild,
	createNode,
	markDirty,
	removeChild,
	setStyle,
	setTextContent,
	TuiElement,
} from "./dom/tree.ts";
export type {
	Ansi256Color,
	AnsiColor,
	BorderStyle,
	Color,
	HexColor,
	RGBColor,
	Styles,
	TextStyles,
} from "./dom/types.ts";
// Editor component interface (for custom editors)
export type { EditorComponent } from "./editor-component.ts";
export {
	cancelAnimationFrame,
	type FrameRequestCallback,
	flushAnimationFrames,
	hasPendingFrames,
	requestAnimationFrame,
} from "./engine/animation.ts";
export { FocusManager } from "./engine/focus.ts";
export { type NewOverlayHandle, OverlayManager } from "./engine/overlay.ts";
export { TuiEngine } from "./engine.ts";
// Fuzzy matching
export { type FuzzyMatch, fuzzyFilter, fuzzyMatch } from "./fuzzy.ts";
// Keybindings
export {
	getKeybindings,
	type Keybinding,
	type KeybindingConflict,
	type KeybindingDefinition,
	type KeybindingDefinitions,
	type Keybindings,
	type KeybindingsConfig,
	KeybindingsManager,
	setKeybindings,
	TUI_KEYBINDINGS,
} from "./keybindings.ts";
// Keyboard input handling
export {
	decodeKittyPrintable,
	isKeyRelease,
	isKeyRepeat,
	isKittyProtocolActive,
	Key,
	type KeyEventType,
	type KeyId,
	matchesKey,
	parseKey,
	setKittyProtocolActive,
} from "./keys.ts";
// New Yoga-backed TUI engine (P1+)
export { applyTextStyles, colorizeBg, colorizeFg } from "./output/colorize.ts";
export { Output } from "./output/output.ts";
export { renderBorder } from "./output/render-border.ts";
export { renderNode } from "./output/render-node.ts";
export { type Cell, type CellStyle, EMPTY_CELL, WIDE_CELL_PLACEHOLDER } from "./screen/cell.ts";
export { CharPool, type HyperlinkEntry, HyperlinkPool, StylePool } from "./screen/pool.ts";
export { Screen } from "./screen/screen.ts";
// Input buffering for batch splitting
export { StdinBuffer, type StdinBufferEventMap, type StdinBufferOptions } from "./stdin-buffer.ts";
// Terminal interface and implementations
export { ProcessTerminal, type Terminal } from "./terminal.ts";
// Terminal colors
export {
	parseOsc11BackgroundColor,
	parseTerminalColorSchemeReport,
	type RgbColor,
	type TerminalColorScheme,
} from "./terminal-colors.ts";
// Terminal image support
export {
	allocateImageId,
	type CellDimensions,
	calculateImageRows,
	deleteAllKittyImages,
	deleteKittyImage,
	detectCapabilities,
	encodeITerm2,
	encodeKitty,
	getCapabilities,
	getCellDimensions,
	getGifDimensions,
	getImageDimensions,
	getJpegDimensions,
	getPngDimensions,
	getWebpDimensions,
	hyperlink,
	type ImageDimensions,
	type ImageProtocol,
	type ImageRenderOptions,
	imageFallback,
	renderImage,
	resetCapabilitiesCache,
	setCapabilities,
	setCellDimensions,
	type TerminalCapabilities,
} from "./terminal-image.ts";
export {
	type Component,
	Container,
	CURSOR_MARKER,
	type Focusable,
	isFocusable,
	type OverlayAnchor,
	type OverlayHandle,
	type OverlayMargin,
	type OverlayOptions,
	type OverlayUnfocusOptions,
	type SizeValue,
	TUI,
} from "./tui.ts";
// Utilities
export { sliceByColumn, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "./utils.ts";
