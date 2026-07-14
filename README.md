# @clawnify/html-to-image

> Built and open-sourced by **[clawnify.com](https://clawnify.com)** to benefit the OpenClaw ecosystem. It works with **any OpenClaw agent** — there's nothing Clawnify-specific about it.

An [OpenClaw](https://github.com/openclaw/openclaw) plugin that renders an **HTML string to a PNG file on disk** — no headless browser. It gives agents a native `html_to_image` tool so they can turn HTML/CSS into images (status cards, summaries, simple charts, receipts) and then attach them to any message, email, or channel.

Rendering is done in-process with [Satori](https://github.com/vercel/satori) (HTML/CSS → SVG) and [resvg](https://github.com/thx/resvg-js) (SVG → PNG). No Chromium, no network, no runtime service to call.

## What it does

```
html_to_image({ html, width?, height?, scale?, background?, path? }) → { path, width, height, bytes }
```

The tool writes a PNG to disk and returns its absolute path. What happens next is up to the agent — send it, upload it, or reference it. The plugin has **no opinion** about delivery, which keeps it usable anywhere.

## Install (as an OpenClaw plugin)

```bash
openclaw plugins install @clawnify/html-to-image --pin
openclaw plugins list | grep html-to-image     # → enabled
```

The gateway loads it at startup and the `html_to_image` tool becomes available to agents.

### Bundled skill

Installing the plugin also publishes an **`html-to-image` skill** (to
`~/.openclaw/plugin-skills/html-to-image/`). Agents read it on demand — before
building anything more than a single styled box — and it carries the flexbox-CSS
rules plus copy-paste **card / leaderboard / receipt** examples. This is where
agents learn *how to write HTML that Satori accepts*, so the always-loaded tool
description stays short.

```bash
openclaw skills list | grep html-to-image      # → ✓ ready
```

## Use as a library

```ts
import { htmlToImage } from "@clawnify/html-to-image";

const { path, width, height } = await htmlToImage(
  `<div style="display:flex;padding:48px;background:#0f172a;color:#fff;font-family:Inter;font-size:48px">
     Deploy succeeded ✓
   </div>`,
  { width: 1200, outputPath: "/tmp/card.png" }, // omit outputPath to get just the buffer
);
```

Returns `{ buffer, path?, width, height, overflow, warnings }`.

## Overflow detection

Satori silently **clips** anything larger than the image — it doesn't error — which is an easy way to ship a card with a cut-off heading. So every render measures each element's box against the canvas and reports it:

This measures against the **image** only. Content truncated *inside* the layout — a narrow column or a fixed-width cell that still fits the image — is **not** reported: Satori exposes no reliable way to tell that apart from ordinary overlap (an overlapping avatar stack looks the same to a geometry check), so guessing it produces false positives. Keep columns wide by design instead.

```jsonc
"overflow": {
  "horizontal": true,        // content is wider than the image (clipped on the right)
  "vertical": false,         // taller than a FIXED height (always false when height is auto)
  "contentWidth": 1420,      // widest edge actually laid out (CSS px)
  "contentHeight": 480,
  "canvasWidth": 1200,
  "canvasHeight": null,      // null = auto-height
  "clipped": [               // offending nodes, most-overflowing first (capped)
    { "type": "div", "text": "A very long heading…", "right": 1420, "bottom": 96 }
  ]
}
```

The `html_to_image` tool returns `overflow: false` when everything fits, or the report above when something is clipped — so an agent can notice and re-render wider/taller. Since auto-height can never clip vertically, the simplest way to avoid overflow is to omit `height` and only constrain `width`.

## Options

| Option | Default | Notes |
|---|---|---|
| `width` | `1200` | CSS pixels. Height auto-derives from content unless `height` is set. |
| `height` | *(auto)* | Fixed height in CSS pixels. Omit to size to content. |
| `scale` | `2` | Output pixel-density multiplier (2 = retina-crisp). |
| `background` | *(transparent)* | Color painted behind the HTML, e.g. `"#ffffff"`. |
| `path` / `outputPath` | *(temp file)* | Where to write the PNG. Tool defaults to a fresh file under the OS temp dir. |
| `fonts` | Inter 400/700 | Replace the bundled default typeface (library only). |

## Writing HTML that renders

Satori supports a **flexbox subset of CSS** — think Open Graph image, not a full web page:

- Use `display: flex` for layout (no `grid`, no `float`, no `position: absolute` for flow).
- Every element containing text or children should set `display: flex`.
- Use **inline styles**. No stylesheets, no `<style>` cascade, no class-based CSS.
- **No JavaScript** runs, and remote `<img src="https://…">` is not fetched — embed images as `data:` URIs.
- **Write raw characters, not HTML entities** — `&amp;` renders literally as `&amp;`, not `&`.
- Text uses the bundled **Inter** (Latin). Satori paints glyphs **only** from the fonts you give it — it never falls back to the OS — so **emoji render as blank boxes** (the tool returns a `warnings` note), the same on every machine. Draw icons with CSS, or pass a `fonts` array with an emoji font. Non-Latin scripts likewise need their own `fonts`.

If a layout looks wrong, it's almost always a missing `display: flex` on a container.

The two mistakes that silently produce a *garbage* PNG (a CSS dump, or unstyled
text) rather than an error are now caught up front: passing a **`<style>` block**
or a **raw CSS stylesheet** as the `html` throws with a message telling you to
inline the styles. Satori's own cryptic "explicit `display: flex`" layout error
is also rewritten to say which element needs the `display`. So a bad render fails
loud instead of shipping something broken.

## How it works

1. `satori-html` parses your HTML string into the node tree Satori expects.
2. `satori` lays it out and emits an SVG, embedding glyphs as vector paths.
3. `resvg` rasterizes that SVG to PNG at your chosen scale.

Because glyphs are embedded as paths, the rasterizer needs no fonts of its own — the output is deterministic across machines.

## License

MIT
