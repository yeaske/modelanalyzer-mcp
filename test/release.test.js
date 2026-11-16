import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("package.json, server.json and the server agree on name and version", () => {
  const pkg = JSON.parse(read("package.json"));
  const server = JSON.parse(read("server.json"));
  assert.equal(server.name, pkg.mcpName, "server.json name must match package.json mcpName");
  assert.equal(server.version, pkg.version);
  assert.equal(server.packages[0].identifier, pkg.name);
  assert.equal(server.packages[0].version, pkg.version);
  assert.ok(server.description.length <= 100, "the registry limits description to 100 characters");
  assert.match(read("src/server.js"), new RegExp(`version: "${pkg.version.replace(/\./g, "\\.")}"`));
});
