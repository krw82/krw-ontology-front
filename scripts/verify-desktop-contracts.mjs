import { readdir, readFile } from "node:fs/promises";

const root = new URL("../contracts/desktop/v1/", import.meta.url);
const fixtureRoot = new URL("./fixtures/", root);
const forbiddenKeys = new Set([
  "authorization",
  "token",
  "user_id",
  "action_href",
  "source_chat_session_id",
  "source_message_id",
]);

const schemaFiles = (await readdir(root))
  .filter((name) => name.endsWith(".schema.json"))
  .sort();
const fixtureFiles = (await readdir(fixtureRoot))
  .filter((name) => name.endsWith(".json"))
  .sort();

if (schemaFiles.length === 0 || fixtureFiles.length === 0) {
  throw new Error("Desktop contract schemas and fixtures are required");
}

const contractVersions = new Set();
for (const name of schemaFiles) {
  const schema = await readJson(new URL(name, root));
  assert(schema.$schema === "https://json-schema.org/draft/2020-12/schema", `${name}: invalid $schema`);
  assert(typeof schema.$id === "string" && schema.$id.includes("/contracts/desktop/v1/"), `${name}: invalid $id`);
  assert(typeof schema.title === "string" && schema.title, `${name}: title is required`);
  assert(schema.type === "object", `${name}: root type must be object`);
  const version = schema.properties?.contract_version?.const;
  if (typeof version === "string") contractVersions.add(version);
}

for (const name of fixtureFiles) {
  const fixture = await readJson(new URL(name, fixtureRoot));
  assert(fixture.ok === true, `${name}: ok must be true`);
  assert(contractVersions.has(fixture.contract_version), `${name}: unknown contract_version ${fixture.contract_version}`);
  assert(fixture.data && typeof fixture.data === "object", `${name}: data is required`);
  assert(fixture.meta && typeof fixture.meta === "object", `${name}: meta is required`);
  assertNoForbiddenKeys(fixture, name);
}

console.log(
  `OK desktop contracts schemas=${schemaFiles.length} fixtures=${fixtureFiles.length} versions=${[...contractVersions].sort().join(",")}`,
);

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

function assertNoForbiddenKeys(value, source, path = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenKeys(item, source, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert(!forbiddenKeys.has(key.toLowerCase()), `${source}: forbidden key ${path}.${key}`);
    assertNoForbiddenKeys(child, source, `${path}.${key}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
