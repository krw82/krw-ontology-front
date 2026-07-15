import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = fileURLToPath(
  new URL("../contracts/desktop/v1/", import.meta.url),
);
const root = path.resolve(process.env.DESKTOP_CONTRACTS_ROOT ?? defaultRoot);
const fixtureRoot = path.join(root, "fixtures");
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

const schemas = new Map();
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

for (const name of schemaFiles) {
  const schema = await readJson(path.join(root, name));
  assert(
    schema.$schema === "https://json-schema.org/draft/2020-12/schema",
    `${name}: invalid $schema`,
  );
  assert(
    typeof schema.$id === "string" &&
      schema.$id.includes("/contracts/desktop/v1/"),
    `${name}: invalid $id`,
  );
  assert(
    typeof schema.title === "string" && schema.title,
    `${name}: title is required`,
  );
  assert(schema.type === "object", `${name}: root type must be object`);
  schemas.set(name, schema);
  ajv.addSchema(schema, schema.$id);
}

const validators = new Map();
for (const [name, schema] of schemas) {
  const validate = ajv.getSchema(schema.$id);
  assert(validate, `${name}: failed to compile schema`);
  validators.set(name, validate);
}

const coveredSchemas = new Set();
for (const name of fixtureFiles) {
  const schemaName = schemaNameForFixture(name);
  const validate = validators.get(schemaName);
  assert(validate, `${name}: no matching schema ${schemaName}`);

  const fixture = await readJson(path.join(fixtureRoot, name));
  const valid = validate(fixture);
  assert(
    valid,
    `${name}: schema validation failed: ${formatValidationErrors(validate.errors)}`,
  );
  assertNoForbiddenKeys(fixture, name);
  coveredSchemas.add(schemaName);
}

const uncoveredSchemas = schemaFiles.filter((name) => !coveredSchemas.has(name));
assert(
  uncoveredSchemas.length === 0,
  `Missing fixtures for schemas: ${uncoveredSchemas.join(", ")}`,
);

console.log(
  `OK desktop contracts schemas=${schemaFiles.length} fixtures=${fixtureFiles.length} validated=${fixtureFiles.length}`,
);

function schemaNameForFixture(name) {
  const match = name.match(/^(.+)\.(?:success|error)\.json$/);
  assert(
    match,
    `${name}: fixture name must end with .success.json or .error.json`,
  );
  return `${match[1]}.schema.json`;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function formatValidationErrors(errors) {
  if (!errors?.length) return "unknown validation error";
  return errors
    .map((error) => {
      const location = error.instancePath || "$";
      return `${location} ${error.message ?? "is invalid"} (${error.schemaPath})`;
    })
    .join("; ");
}

function assertNoForbiddenKeys(value, source, valuePath = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNoForbiddenKeys(item, source, `${valuePath}[${index}]`),
    );
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert(
      !forbiddenKeys.has(key.toLowerCase()),
      `${source}: forbidden key ${valuePath}.${key}`,
    );
    assertNoForbiddenKeys(child, source, `${valuePath}.${key}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
