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
