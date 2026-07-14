---
name: html-to-image
description: >-
  Author HTML that renders correctly with the html_to_image tool (Satori). Read
  this BEFORE building any card, table, leaderboard, receipt, or chart image —
  it explains the flexbox-only CSS subset and gives copy-paste examples. Use it
  whenever you reach for html_to_image and the output is more than a single line
  of text, or when a render came out blank, black, or as raw text/CSS.
---

# Rendering HTML to an image with `html_to_image`

`html_to_image` renders with **[Satori](https://github.com/vercel/satori)**, the
engine behind Open Graph images — **not a web browser**. It supports a small,
strict **flexbox subset of CSS**. Most "the image came out wrong" problems are
one of the mistakes below. Follow these rules and it works the first time.

## The six rules (break one and you get garbage)

1. **Inline styles only.** Put every style in a `style="…"` attribute on the
   element itself. **`<style>` blocks and CSS classes are silently ignored** —
   they do nothing. (`<div class="card">…</div>` with a `<style>.card{…}</style>`
   renders as *unstyled* content, and a bare stylesheet renders as *literal
   text*. Both look broken.)
2. **Flex everything.** Satori only does flex layout. **Any element with more
   than one child must set `display:flex`** — use `display:flex` for a row or
   `display:flex;flex-direction:column` for a stack. No `grid`, no `float`, no
   `position:absolute` for flow, no `display:block`/`inline`. A single missing
   `display:flex` is the #1 cause of a layout error or a collapsed image.
3. **No JavaScript, no remote images.** Scripts don't run. `<img src="https://…">`
   is **not fetched** — embed images as `data:` URIs, or draw with CSS (colored
   `div`s, gradients, initials-in-a-circle).
4. **Fonts & emoji:** the bundled family is **Inter** (weights 400 & 700, Latin
   only), and Satori paints glyphs *only* from the fonts it's given — it never
   uses the OS's fonts. So **emoji render as blank boxes** (▯), the same on every
   machine — 🥇/📡/📊 will *not* work. Don't use them; draw icons with CSS (a
   rounded `div` + inner bars/shapes) or use text. The tool returns a `warnings`
   entry when it spots emoji. Non-Latin scripts (CJK, Arabic, …) likewise need
   their own `fonts`.
5. **Write text as raw characters** — including `&`. HTML entities are **not
   decoded**: `&amp;` shows literally as "&amp;", not "&". So type `A & B`, not
   `A &amp; B`.
6. **Size with `width`, let height auto-grow.** Pass the tool a `width` and omit
   `height` so the canvas grows to fit — that way content can't be clipped by the
   image edge. The root element should also set an explicit pixel `width`.

## The tool call

```
html_to_image({
  html,                 // your inline-styled markup (see examples)
  width?,               // canvas width in CSS px, default 1200
  height?,              // omit to auto-size (recommended)
  scale?,               // pixel density, default 2 (retina-crisp)
  background?,          // e.g. "#ffffff" — set this if your text is dark
  path?                 // optional output path; defaults to a temp file
}) → { path, width, height, bytes, overflow }
```

- It writes a PNG and returns the `path`. **Delivery is up to you** — upload it,
  attach it, `[file:…]` it, whatever the channel needs.
- **Check `overflow`.** `false` means everything fit. Otherwise each clipped node
  carries a `by`: `"canvas"` = wider/taller than the image → re-render with a
  larger `width`; `"container"` = a fixed-width cell or shrunk column is
  truncating its content → **widen that element** (give the column more room or a
  larger `width`), not just the image. (One case slips through: text hidden by an
  explicit `overflow:hidden` + `white-space:nowrap` on the element itself — Satori
  clamps it silently, so keep such columns wide enough by design.)
- **Check `warnings`.** Non-fatal notes about input that rendered but probably not
  as intended — today, emoji. If present, fix and re-render.
- **On an error, read the message** — it tells you exactly which rule you broke
  (a `<style>` block, a raw CSS string, or a missing `display:flex`). Fix and
  re-render; do **not** fall back to plain text.

## Example 1 — a status card

```html
<div style="display:flex;flex-direction:column;width:600px;padding:32px;
            background:#0f172a;border-radius:20px;font-family:Inter">
  <div style="display:flex;align-items:center;gap:10px">
    <div style="display:flex;font-size:22px;font-weight:700;color:#f1f5f9">Deploy succeeded</div>
    <div style="display:flex;background:#14b8a6;color:#042f2e;font-size:12px;font-weight:700;
                padding:3px 10px;border-radius:999px">v2.4.1</div>
  </div>
  <div style="display:flex;font-size:14px;color:#94a3b8;margin-top:6px">
    api-worker · 12s · 3 files changed
  </div>
</div>
```

## Example 2 — a leaderboard / ranked table

The pattern that trips agents up. Every row is `display:flex`; the middle column
is a `flex-direction:column` stack; the avatar is a flex box with centered
initials (no image needed).

```html
<div style="display:flex;flex-direction:column;width:760px;padding:36px;gap:10px;
            background:#0f172a;font-family:Inter">
  <div style="display:flex;flex-direction:column;margin-bottom:8px">
    <div style="display:flex;font-size:24px;font-weight:700;color:#f1f5f9">LinkedIn Hot Leads</div>
    <div style="display:flex;font-size:13px;color:#94a3b8">Top B2B prospects · Jul 14, 2026</div>
  </div>

  <div style="display:flex;align-items:center;gap:14px;padding:14px 18px;
              background:#1e293b;border-radius:14px;border:1px solid #334155">
    <div style="display:flex;width:26px;font-size:16px;font-weight:700;color:#fbbf24">1</div>
    <div style="display:flex;width:40px;height:40px;border-radius:20px;background:#14b8a6;
                align-items:center;justify-content:center;font-weight:700;color:#042f2e">MS</div>
    <div style="display:flex;flex-direction:column;flex:1">
      <div style="display:flex;font-size:15px;font-weight:600;color:#f1f5f9">Michael Shafir</div>
      <div style="display:flex;font-size:12px;color:#94a3b8">CEO &amp; VP Marketing · 4 engagements</div>
    </div>
    <div style="display:flex;font-size:18px;font-weight:700;color:#14b8a6">9/10</div>
  </div>

  <!-- repeat the row above per entry: change rank, initials, name, title, score -->
</div>
```

To build the full list, generate one row block per record and concatenate them
between the header and the closing `</div>`. Keep `width:760` (or wider) so long
names don't clip — check `overflow` in the result.

## Example 3 — a receipt / summary (light theme)

Set `background:"#ffffff"` in the tool call when your text is dark.

```html
<div style="display:flex;flex-direction:column;width:420px;padding:28px;
            background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;font-family:Inter">
  <div style="display:flex;font-size:18px;font-weight:700;color:#0f172a">Order #4821</div>
  <div style="display:flex;justify-content:space-between;margin-top:16px">
    <div style="display:flex;color:#475569;font-size:14px">Subtotal</div>
    <div style="display:flex;color:#0f172a;font-size:14px;font-weight:600">$48.00</div>
  </div>
  <div style="display:flex;justify-content:space-between;margin-top:8px">
    <div style="display:flex;color:#475569;font-size:14px">Tax</div>
    <div style="display:flex;color:#0f172a;font-size:14px;font-weight:600">$4.08</div>
  </div>
  <div style="display:flex;justify-content:space-between;margin-top:16px;
              padding-top:16px;border-top:1px solid #e2e8f0">
    <div style="display:flex;color:#0f172a;font-size:16px;font-weight:700">Total</div>
    <div style="display:flex;color:#0f172a;font-size:16px;font-weight:700">$52.08</div>
  </div>
</div>
```

## Quick fixes

| Symptom | Cause | Fix |
|---|---|---|
| Error: "contains a `<style>` block" | CSS in a `<style>` tag or classes | Move every rule inline onto its element; delete the `<style>` and `class` attributes. |
| Error: "looks like a raw CSS stylesheet" | You passed CSS as the `html` | Wrap content in HTML elements with inline styles. |
| Error: "explicit display: flex" | A multi-child element has no display | Add `display:flex` (or `+flex-direction:column`) to that element. |
| Image is blank / just a background | Content has no `display:flex` so it collapsed | Give text/child containers `display:flex`. |
| Dark text on transparent → invisible | No background | Pass `background:"#ffffff"` (or set it on the root). |
| Blank boxes ▯ where emoji should be | No emoji font (bundled Inter is Latin-only) | Remove emoji; use text or CSS-drawn icons. Shows as a `warnings` entry. |
| Literal `&amp;` / `&lt;` in the text | HTML entities aren't decoded | Write the raw character (`&`), not the entity. |
| `overflow.by:"canvas"` | Content wider/taller than the image | Re-render with a larger `width` (or `height`). |
| `overflow.by:"container"` | A fixed-width cell / shrunk column truncates content | Widen that element — more column room, or a larger canvas `width`. |
