/**
 * @linghun/ink-runtime style extensions — CCB-compatible `opaque` support.
 *
 * `opaque` fills a Box's interior (padding included) with spaces before
 * rendering children, so nothing behind it shows through. Like `backgroundColor`
 * but without emitting SGR codes — the terminal's default background is used.
 *
 * Useful for absolute-positioned overlays where Box padding/gaps would
 * otherwise be transparent.
 *
 * ## Implementation
 *
 * The open-source ink 7 renderer does not natively process `opaque`. When a
 * Box has a `backgroundColor`, ink fills its interior with that color, which
 * provides opacity automatically. For pure `opaque` (no color), set
 * `backgroundColor` to the terminal's default background (typically undefined
 * for dark terminals, "white" for light).
 *
 * `OpaqueBoxProps` extends the standard ink `BoxProps` with the `opaque` flag
 * for type-safe use in components that consume this package.
 */

import type { BoxProps } from "ink";

export type OpaqueBoxProps = BoxProps & {
  /** Fill interior with spaces so nothing behind shows through. */
  readonly opaque?: boolean;
};
