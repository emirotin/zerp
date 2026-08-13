import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizePathToDeckRelative } from "../dist/check/probe.js";

test("normalizePathToDeckRelative: path genuinely under root", () => {
  const result = normalizePathToDeckRelative("/a/b/image.png", "/a/b");
  assert.equal(result, "image.png");
});

test("normalizePathToDeckRelative: nested path under root", () => {
  const result = normalizePathToDeckRelative("/a/b/subdir/image.png", "/a/b");
  assert.equal(result, "subdir/image.png");
});

test("normalizePathToDeckRelative: sibling directory with shared prefix does NOT match", () => {
  const result = normalizePathToDeckRelative("/a/bc/image.png", "/a/b");
  assert.equal(result, null, "sibling /a/bc should not match root /a/b");
});

test("normalizePathToDeckRelative: path entirely outside root", () => {
  const result = normalizePathToDeckRelative("/c/d/image.png", "/a/b");
  assert.equal(result, null);
});

test("normalizePathToDeckRelative: path exactly equal to root", () => {
  const result = normalizePathToDeckRelative("/a/b", "/a/b");
  assert.equal(result, null, "root path itself is not under root");
});

test("normalizePathToDeckRelative: common parent but different branches", () => {
  const result = normalizePathToDeckRelative("/home/user2/project/img.png", "/home/user/project");
  assert.equal(result, null);
});
