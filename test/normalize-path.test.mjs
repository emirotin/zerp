import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Convert an absolute filesystem path to a deck-relative path.
 * Returns the relative path if it's genuinely under rootDir, null otherwise.
 * Uses a trailing-slash boundary to avoid matching sibling directories.
 */
export function normalizePathToDeckRelative(absolutePath, rootDir) {
  const prefix = `${rootDir}/`;
  if (absolutePath.startsWith(prefix)) {
    return absolutePath.slice(prefix.length);
  }
  return null;
}

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
