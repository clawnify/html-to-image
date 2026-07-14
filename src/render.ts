// Core HTML -> PNG renderer.
//
// Pipeline (all in-process, no headless browser):
//   satori-html  parses the HTML string into the node tree Satori expects
//   satori       lays it out (a flexbox CSS subset) and emits an SVG, with the
//                glyphs embedded as vector paths (embedFont defaults to true)
//   resvg        rasterizes that SVG to a PNG buffer
//
// Because Satori embeds the font glyphs as paths, resvg never needs a font
// configured — it just paints the paths. The bundled Inter (400/700, latin)
// is the default typeface; callers can replace it via `fonts`.

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import satori from "satori";
import { html as parseHtml } from "satori-html";
import { Resvg } from "@resvg/resvg-js";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FONT_DIR = join(PKG_ROOT, "fonts");

export type FontWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;

export interface FontInput {
  /** Font family name, referenced by `font-family` in the HTML. */
  name: string;
  /** Font file bytes. TTF/OTF/WOFF only — WOFF2 is not supported. */
  data: Buffer | ArrayBuffer;
  weight?: FontWeight;
  style?: "normal" | "italic";
}

export interface HtmlToImageOptions {
  /** Width in CSS pixels. Default 1200. Height auto-derives from content unless `height` is set. */
  width?: number;
  /** Fixed height in CSS pixels. Omit to auto-size to the content. */
  height?: number;
  /** Output pixel-density multiplier for crisp images. Default 2 (retina). */
  scale?: number;
  /** Background color painted behind the HTML, e.g. "#ffffff". Default transparent. */
  background?: string;
  /** Replaces the bundled default fonts when provided. Must be non-empty. */
  fonts?: FontInput[];
  /** When set, the PNG is written here (parent dirs are created) and echoed back on `path`. */
  outputPath?: string;
}

/** A node whose box is clipped — by the image edge or by a constrained ancestor. */
export interface ClippedNode {
  type: string;
  /** Text content, if this is a text node. */
  text?: string;
  /** Right edge in CSS px (left + width). */
  right: number;
  /** Bottom edge in CSS px (top + height). */
  bottom: number;
  /**
   * What cut it off: `"canvas"` = wider/taller than the image (re-render bigger);
   * `"container"` = fits the image but overflows a fixed-size / shrunk ancestor
   * (a truncated column or cell — widen that ancestor, don't just grow the image).
   */
  by: "canvas" | "container";
}

/**
 * Whether any content gets clipped — either by the image bounds (`"canvas"`) or
 * by a constrained ancestor it overflows (`"container"`: a fixed-width cell or a
 * shrunk `flex`/`min-width:0` column whose text is truncated, which a canvas-only
 * check misses). All measurements are in CSS pixels (pre-`scale`), matching the
 * values you pass in. Canvas *vertical* overflow is impossible when `height` is
 * omitted (auto-height grows to fit) — but container-vertical clips are still
 * caught even then.
 */
export interface OverflowReport {
  /** Something is clipped horizontally — by the image edge or a container. */
  horizontal: boolean;
  /** Something is clipped vertically — by a fixed-height image or a container. */
  vertical: boolean;
  /** Widest right edge observed across all nodes (CSS px). */
  contentWidth: number;
  /** Tallest bottom edge observed across all nodes (CSS px). */
  contentHeight: number;
  /** The image bounds the content was measured against (CSS px; height null = auto). */
  canvasWidth: number;
  canvasHeight: number | null;
  /** Nodes that extend past an edge, most-overflowing first (capped at 8). */
  clipped: ClippedNode[];
}

export interface HtmlToImageResult {
  /** The PNG bytes. */
  buffer: Buffer;
  /** Where the PNG was written, if `outputPath` was given. */
  path?: string;
  /** Actual output pixel dimensions (after `scale`). */
  width: number;
  height: number;
  /** Whether any element is clipped (by the image bounds or a container). */
  overflow: OverflowReport;
  /**
   * Non-fatal advisories about the input that rendered but probably not as
   * intended — e.g. emoji (Satori has no emoji font, so they paint as blank
   * boxes). Empty when nothing looks off.
   */
  warnings: string[];
}

interface DetectedNode {
  left: number;
  top: number;
  width: number;
  height: number;
  type: string;
  textContent?: string;
}

// Sub-pixel rounding means boxes land a hair over the edge; ignore <1px spill.
const OVERFLOW_EPSILON = 1;

// Satori reports each node's *pre-clip* layout box in tree (pre-order) sequence,
// so a node's nearest enclosing ancestor is the most recent earlier node that
// contains its top-left origin. Returns that ancestor's index, or -1.
function enclosingAncestor(nodes: DetectedNode[], i: number): number {
  const n = nodes[i];
  for (let j = i - 1; j >= 0; j--) {
    const a = nodes[j];
    const aRight = a.left + a.width;
    const aBottom = a.top + a.height;
    // Origin must be STRICTLY inside `a`, not merely touching its right/bottom
    // edge — otherwise an adjacent sibling (the previous line in a column, the
    // previous cell in a row) that N butts up against reads as a container.
    if (
      a.left <= n.left + OVERFLOW_EPSILON &&
      a.top <= n.top + OVERFLOW_EPSILON &&
      n.left < aRight - OVERFLOW_EPSILON &&
      n.top < aBottom - OVERFLOW_EPSILON
    ) {
      return j;
    }
  }
  return -1;
}

function measureOverflow(
  nodes: DetectedNode[],
  canvasWidth: number,
  canvasHeight: number | null,
): OverflowReport {
  let contentWidth = 0;
  let contentHeight = 0;
  let horizontal = false;
  let vertical = false;
  const clipped: (ClippedNode & { over: number })[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const right = n.left + n.width;
    const bottom = n.top + n.height;
    if (right > contentWidth) contentWidth = right;
    if (bottom > contentHeight) contentHeight = bottom;

    // 1. Clipped by the image edge.
    const overX = right - canvasWidth;
    const overY = canvasHeight == null ? 0 : bottom - canvasHeight;
    if (overX > OVERFLOW_EPSILON || overY > OVERFLOW_EPSILON) {
      if (overX > OVERFLOW_EPSILON) horizontal = true;
      if (overY > OVERFLOW_EPSILON) vertical = true;
      clipped.push({
        type: n.type, text: n.textContent,
        right: Math.round(right), bottom: Math.round(bottom),
        by: "canvas", over: Math.max(overX, overY),
      });
      continue; // canvas clip subsumes any ancestor clip for this node
    }

    // 2. Clipped by a constrained ancestor it overflows (fits the canvas, but
    //    e.g. a truncated column or fixed-width cell). A canvas-only check
    //    misses these — they're the most common "why is my text cut off?" case.
    const ai = enclosingAncestor(nodes, i);
    if (ai >= 0) {
      const a = nodes[ai];
      const aRight = a.left + a.width;
      const aBottom = a.top + a.height;
      const cOverX = right - aRight;
      const cOverY = bottom - aBottom;
      if (cOverX > OVERFLOW_EPSILON || cOverY > OVERFLOW_EPSILON) {
        if (cOverX > OVERFLOW_EPSILON) horizontal = true;
        if (cOverY > OVERFLOW_EPSILON) vertical = true;
        clipped.push({
          type: n.type, text: n.textContent,
          right: Math.round(right), bottom: Math.round(bottom),
          by: "container", over: Math.max(cOverX, cOverY),
        });
      }
    }
  }

  clipped.sort((a, b) => b.over - a.over);

  return {
    horizontal,
    vertical,
    contentWidth: Math.round(contentWidth),
    contentHeight: Math.round(contentHeight),
    canvasWidth,
    canvasHeight,
    clipped: clipped.slice(0, 8).map(({ over: _over, ...rest }) => rest),
  };
}

// Satori honors only INLINE `style="…"` on a flexbox CSS subset. It silently
// drops `<style>` blocks and class selectors, and renders anything that isn't
// element markup as literal text. Those two mistakes produce a "successful"
// PNG of garbage (a CSS dump, or unstyled black text) with no error — the worst
// failure mode for an agent, which then ships it believing it worked. Catch
// both up front with a message that says exactly what to do instead.
const STYLE_BLOCK = /<style[\s>]/i;
const HTML_TAG = /<[a-z!/][^>]*>/i;
const CSS_RULE = /[^{}]+\{[^{}]*:[^{}]*\}/; // `selector { prop: value }`

/**
 * Throw a clear, actionable error for the two inputs Satori renders as garbage
 * without erroring: a `<style>` block (CSS is dropped) and a raw CSS stylesheet
 * with no HTML (rendered as literal text).
 */
export function assertRenderableHtml(html: string): void {
  if (STYLE_BLOCK.test(html)) {
    throw new Error(
      "input contains a <style> block, which Satori ignores — it only applies " +
        'INLINE styles. Move every rule onto its element as a style="" attribute ' +
        '(e.g. <div style="display:flex;color:#fff">), drop the <style> block and ' +
        "CSS classes, and re-render. See the html-to-image skill for examples.",
    );
  }
  if (!HTML_TAG.test(html) && CSS_RULE.test(html)) {
    throw new Error(
      "input looks like a raw CSS stylesheet, not HTML — Satori would render it " +
        "as literal text. Pass HTML elements with inline styles instead " +
        '(e.g. <div style="display:flex;padding:24px;font-family:Inter">…</div>). ' +
        "See the html-to-image skill for examples.",
    );
  }
}

/**
 * Satori's own layout error for a non-flex container with multiple children is
 * cryptic ("Expected <div> to have explicit ...") — rewrite it to say why and
 * how to fix it. Returns the original error unchanged if it doesn't match.
 */
function explainSatoriError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  if (/explicit "display: ?flex"|display: ?flex.*more than one child/i.test(message)) {
    return new Error(
      message +
        " — Satori only does flex layout, so any element with more than one child " +
        'needs an explicit display. Add style="display:flex" (rows) or ' +
        '"display:flex;flex-direction:column" (stacks) to that element.',
    );
  }
  return err instanceof Error ? err : new Error(message);
}

// The bundled fonts are Inter (Latin) only, and Satori paints glyphs *only* from
// the fonts it is given — it never falls back to the OS. So emoji (and any script
// the fonts don't cover) render as blank ".notdef" boxes, identically on every
// machine. Flag emoji in the input so the caller isn't surprised by tofu.
const EMOJI = /(\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\u{1F1E6}-\u{1F1FF}])/u;
function emojiWarning(html: string, hasCustomFonts: boolean): string | null {
  if (hasCustomFonts) return null; // caller supplied fonts; assume they cover it
  // Strip tags so we only inspect text/attribute content the user actually sees.
  const text = html.replace(/<[^>]*>/g, " ");
  const found = [...new Set(text.match(new RegExp(EMOJI, "gu")) ?? [])];
  if (found.length === 0) return null;
  return (
    `input contains emoji (${found.slice(0, 8).join(" ")}) — the bundled Inter font ` +
    "has no emoji glyphs, so they render as blank boxes. Remove them (use text or " +
    "CSS-drawn icons), or pass a `fonts` array that includes an emoji font."
  );
}

let defaultFontsCache: FontInput[] | null = null;
function defaultFonts(): FontInput[] {
  if (!defaultFontsCache) {
    defaultFontsCache = [
      { name: "Inter", data: readFileSync(join(FONT_DIR, "Inter-400.woff")), weight: 400, style: "normal" },
      { name: "Inter", data: readFileSync(join(FONT_DIR, "Inter-700.woff")), weight: 700, style: "normal" },
    ];
  }
  return defaultFontsCache;
}

/** Render an HTML string to a PNG. Writes to `outputPath` when provided; always returns the bytes. */
export async function htmlToImage(
  html: string,
  options: HtmlToImageOptions = {},
): Promise<HtmlToImageResult> {
  if (!html || !html.trim()) throw new Error("html must be a non-empty string");
  assertRenderableHtml(html);

  const width = options.width ?? 1200;
  const scale = options.scale ?? 2;
  const fonts = options.fonts ?? defaultFonts();
  if (fonts.length === 0) throw new Error("at least one font is required");

  const markup = parseHtml(html);

  // Collect each node's computed box so we can tell the caller whether anything
  // spilled past the image bounds (Satori clips, it doesn't error).
  const detected: DetectedNode[] = [];
  const onNodeDetected = (node: DetectedNode) => {
    detected.push({
      left: node.left,
      top: node.top,
      width: node.width,
      height: node.height,
      type: node.type,
      textContent: node.textContent,
    });
  };

  const satoriOptions =
    options.height != null
      ? { width, height: options.height, fonts, onNodeDetected }
      : { width, fonts, onNodeDetected };

  // satori-html's node shape and Satori's ReactNode type don't line up in TS,
  // but they're compatible at runtime — this is the documented Node pairing.
  let svg: string;
  try {
    svg = await satori(markup as unknown as never, satoriOptions as never);
  } catch (err) {
    throw explainSatoriError(err);
  }

  const resvg = new Resvg(svg, {
    fitTo: { mode: "zoom", value: scale },
    ...(options.background ? { background: options.background } : {}),
  });
  const rendered = resvg.render();
  const buffer = Buffer.from(rendered.asPng());

  const overflow = measureOverflow(detected, width, options.height ?? null);
  const warnings: string[] = [];
  const emoji = emojiWarning(html, options.fonts != null && options.fonts.length > 0);
  if (emoji) warnings.push(emoji);

  const result: HtmlToImageResult = {
    buffer,
    width: rendered.width,
    height: rendered.height,
    overflow,
    warnings,
  };

  if (options.outputPath) {
    mkdirSync(dirname(options.outputPath), { recursive: true });
    writeFileSync(options.outputPath, buffer);
    result.path = options.outputPath;
  }

  return result;
}

/** A fresh temp path under the OS temp dir, e.g. /tmp/clawnify-html-image/<uuid>.png */
export function defaultOutputPath(ext = "png"): string {
  return join(tmpdir(), "clawnify-html-image", `${randomUUID()}.${ext}`);
}
