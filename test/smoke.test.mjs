import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlToImage } from "../dist/index.js";

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

test("renders HTML to a PNG buffer", async () => {
  const res = await htmlToImage(
    "<div style='display:flex;padding:40px;font-family:Inter;font-size:40px'>hello</div>",
  );
  assert.ok(res.buffer.length > 0, "expected non-empty PNG");
  assert.deepEqual([...res.buffer.subarray(0, 4)], PNG_MAGIC, "expected PNG magic bytes");
  assert.equal(res.overflow.horizontal, false);
  assert.equal(res.overflow.vertical, false);
});

test("scale doubles the output dimensions", async () => {
  const res = await htmlToImage(
    "<div style='display:flex;width:200px;height:100px;font-family:Inter'>x</div>",
    { width: 200, height: 100, scale: 2 },
  );
  assert.equal(res.width, 400);
  assert.equal(res.height, 200);
});

test("flags horizontal overflow for non-shrinkable content", async () => {
  const res = await htmlToImage(
    "<div style='display:flex;width:300px;font-family:Inter'><div style='display:flex;flex-shrink:0;width:600px;height:80px'>x</div></div>",
    { width: 300 },
  );
  assert.equal(res.overflow.horizontal, true);
  assert.ok(res.overflow.clipped.length > 0);
});

test("flags vertical overflow when a fixed height is too small", async () => {
  const res = await htmlToImage(
    "<div style='display:flex;flex-direction:column;width:400px;font-family:Inter'><div style='display:flex;height:400px'>tall</div></div>",
    { width: 400, height: 200 },
  );
  assert.equal(res.overflow.vertical, true);
});

test("rejects empty html", async () => {
  await assert.rejects(() => htmlToImage("   "), /non-empty/);
});

test("rejects a <style> block with an actionable message", async () => {
  await assert.rejects(
    () => htmlToImage("<style>.card{display:flex}</style><div class='card'>hi</div>"),
    /<style> block.*INLINE/s,
  );
});

test("rejects a raw CSS stylesheet passed as html", async () => {
  await assert.rejects(
    () => htmlToImage("body { display: flex; background: #0f172a; } .card { padding: 24px; }"),
    /raw CSS stylesheet/,
  );
});

test("explains Satori's cryptic multi-child display error", async () => {
  await assert.rejects(
    // A div with two children and no display:flex — Satori's own error.
    () => htmlToImage("<div style='font-family:Inter'><div>a</div><div>b</div></div>"),
    /Satori only does flex layout/,
  );
});

test("plain text (no tags, no CSS rules) still renders", async () => {
  const res = await htmlToImage("Deploy succeeded");
  assert.deepEqual([...res.buffer.subarray(0, 4)], PNG_MAGIC);
});

test("flags content clipped by a fixed-width ancestor (fits the canvas)", async () => {
  const res = await htmlToImage(
    "<div style='display:flex;width:1200px;font-family:Inter'><div style='display:flex;width:300px;height:60px'><div style='display:flex;flex-shrink:0;width:900px;height:60px'>x</div></div></div>",
    { width: 1200 },
  );
  assert.equal(res.overflow.horizontal, true);
  assert.equal(res.overflow.clipped[0].by, "container");
});

test("canvas overflow is tagged by:'canvas'", async () => {
  const res = await htmlToImage(
    "<div style='display:flex;width:1400px;height:60px;font-family:Inter'>wide</div>",
    { width: 1200 },
  );
  assert.equal(res.overflow.horizontal, true);
  assert.equal(res.overflow.clipped[0].by, "canvas");
});

test("a well-formed multi-row card does not false-positive", async () => {
  const row = (n) =>
    `<div style='display:flex;align-items:center;gap:14px;padding:14px'>` +
    `<div style='display:flex;width:26px;font-size:16px'>${n}</div>` +
    `<div style='display:flex;width:40px;height:40px;border-radius:20px;background:#14b8a6'></div>` +
    `<div style='display:flex;flex-direction:column;flex:1;min-width:0'>` +
    `<div style='display:flex;font-size:15px'>Name ${n}</div>` +
    `<div style='display:flex;font-size:12px'>Title ${n}</div></div>` +
    `<div style='display:flex;font-size:18px'>9/10</div></div>`;
  const res = await htmlToImage(
    `<div style='display:flex;flex-direction:column;width:760px;padding:36px;gap:10px;font-family:Inter'>${row(1)}${row(2)}${row(3)}</div>`,
    { width: 760 },
  );
  assert.equal(res.overflow.horizontal, false);
  assert.equal(res.overflow.vertical, false);
  assert.equal(res.warnings.length, 0);
});

test("warns (non-fatally) about emoji", async () => {
  const res = await htmlToImage(
    "<div style='display:flex;padding:40px;font-family:Inter;font-size:40px'>Report 📊 ready</div>",
  );
  assert.deepEqual([...res.buffer.subarray(0, 4)], PNG_MAGIC, "still renders");
  assert.equal(res.warnings.length, 1);
  assert.match(res.warnings[0], /emoji/);
});
