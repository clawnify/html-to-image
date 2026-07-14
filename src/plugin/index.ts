// OpenClaw plugin entry — registers the `html_to_image` tool.
//
// Typed against a minimal local PluginApi so this package builds standalone
// without depending on the openclaw host at compile time. The gateway loader
// resolves the default export's `register` (package.json `main` -> dist/index.js).

import { htmlToImage, defaultOutputPath } from "../render.js";

interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

interface PluginApi {
  registerTool(def: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    execute: (id: string, params: Record<string, unknown>) => Promise<ToolResult>;
  }): void;
  logger?: { info?: (msg: string) => void; error?: (msg: string) => void };
}

function textResult(value: unknown): ToolResult {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }] };
}

function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

const DESCRIPTION = [
  "Render an HTML string to a PNG image file on disk and return its path.",
  "Use this to turn HTML/CSS into an image you can attach to a message, email, or channel —",
  "e.g. a status-update card, a summary, or a simple chart.",
  "CRITICAL: this renders a flexbox CSS subset with Satori (like an Open Graph image), NOT a browser.",
  'Style every element with INLINE style="" attributes — <style> blocks and CSS classes are IGNORED,',
  "and any element with more than one child needs an explicit display:flex. No JavaScript runs and",
  "remote <img> URLs are not fetched (use data: URIs). If you are building anything beyond a single",
  "styled box, read the `html-to-image` skill first — it has copy-paste card/table/receipt examples.",
  "The result reports `overflow` when any element is clipped by the image bounds —",
  "if so, re-render with a larger width/height. The returned file is yours to send however",
  "you like (upload it, attach it, reference it).",
].join(" ");

const plugin = {
  id: "html-to-image",
  name: "HTML to Image",
  description: "Render an HTML string to a PNG file on disk.",
  register(api: PluginApi): void {
    api.registerTool({
      name: "html_to_image",
      description: DESCRIPTION,
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["html"],
        properties: {
          html: {
            type: "string",
            description:
              'HTML markup with INLINE styles only (style="…" on each element). ' +
              "No <style> blocks, no CSS classes, no <img> URLs — Satori ignores them. " +
              "Give the root element display:flex and a width; give any multi-child element display:flex.",
          },
          width: {
            type: "number",
            description: "Image width in CSS pixels. Default 1200. Height auto-derives from content unless `height` is set.",
          },
          height: {
            type: "number",
            description: "Optional fixed height in CSS pixels. Omit to auto-size to the content.",
          },
          scale: {
            type: "number",
            description: "Output pixel-density multiplier for crisp images. Default 2 (retina).",
          },
          background: {
            type: "string",
            description: "Optional background color behind the HTML, e.g. '#ffffff'. Default transparent.",
          },
          path: {
            type: "string",
            description: "Optional absolute output path for the PNG. Defaults to a fresh temp file under the OS temp dir.",
          },
        },
      },
      async execute(_id, params) {
        try {
          const html = typeof params.html === "string" ? params.html : "";
          if (!html.trim()) return errorResult("`html` is required and must be a non-empty string.");

          const outputPath = typeof params.path === "string" && params.path.trim()
            ? params.path
            : defaultOutputPath();

          const res = await htmlToImage(html, {
            width: typeof params.width === "number" ? params.width : undefined,
            height: typeof params.height === "number" ? params.height : undefined,
            scale: typeof params.scale === "number" ? params.scale : undefined,
            background: typeof params.background === "string" ? params.background : undefined,
            outputPath,
          });

          return textResult({
            path: res.path,
            width: res.width,
            height: res.height,
            bytes: res.buffer.length,
            // Non-fatal: the image was written, but flags clipped content so the
            // agent can re-render with a larger width/height if it matters.
            overflow: res.overflow.horizontal || res.overflow.vertical
              ? res.overflow
              : false,
          });
        } catch (err) {
          return errorResult(`html_to_image failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    });

    api.logger?.info?.("[html-to-image] registered tool html_to_image");
  },
};

export default plugin;
