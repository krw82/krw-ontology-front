#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

function usage() {
  console.error(
    "Usage: verify-supabase-schema-smoke-rpc-contract.mjs [--smoke FILE] [--types FILE]",
  );
}

function readOptionPath(value, flag) {
  if (!value) {
    usage();
    throw new Error(`${flag} requires a file path`);
  }
  return path.resolve(value);
}

let smokePath = path.join(repoRoot, "scripts", "supabase-schema-smoke.mjs");
let typesPath = path.join(repoRoot, "src", "types", "database.ts");
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === "--smoke") {
    smokePath = readOptionPath(process.argv[++index], "--smoke");
  } else if (argument === "--types") {
    typesPath = readOptionPath(process.argv[++index], "--types");
  } else if (argument === "--help" || argument === "-h") {
    usage();
    process.exit(0);
  } else {
    usage();
    throw new Error(`unknown option: ${argument}`);
  }
}

for (const filePath of [smokePath, typesPath]) {
  if (!existsSync(filePath)) {
    throw new Error(`required contract file is missing: ${filePath}`);
  }
}

function propertyNameText(name) {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text;
  }
  return null;
}

function findProperty(typeLiteral, name) {
  return typeLiteral.members.find(
    (member) =>
      ts.isPropertySignature(member) && propertyNameText(member.name) === name,
  );
}

function loadDatabaseFunctionInputs(filePath) {
  const source = ts.createSourceFile(
    filePath,
    readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let functionsProperty;
  const visit = (node) => {
    if (
      ts.isPropertySignature(node) &&
      propertyNameText(node.name) === "Functions" &&
      ts.isTypeLiteralNode(node.type)
    ) {
      functionsProperty = node;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  if (!functionsProperty || !ts.isTypeLiteralNode(functionsProperty.type)) {
    throw new Error(`${filePath} does not expose Database.public.Functions`);
  }

  const functions = new Map();
  for (const member of functionsProperty.type.members) {
    if (!ts.isPropertySignature(member) || !ts.isTypeLiteralNode(member.type)) {
      continue;
    }
    const functionName = propertyNameText(member.name);
    if (!functionName) continue;
    const argsProperty = findProperty(member.type, "Args");
    if (!argsProperty || !ts.isTypeLiteralNode(argsProperty.type)) continue;

    const inputs = new Map();
    for (const argument of argsProperty.type.members) {
      if (!ts.isPropertySignature(argument)) continue;
      const inputName = propertyNameText(argument.name);
      if (inputName) inputs.set(inputName, Boolean(argument.questionToken));
    }
    functions.set(functionName, inputs);
  }
  return functions;
}

function literalString(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : null;
}

function literalObjectKeys(node) {
  if (!ts.isObjectLiteralExpression(node)) return null;
  const keys = [];
  for (const property of node.properties) {
    if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
      const key = propertyNameText(property.name);
      if (!key) return null;
      keys.push(key);
      continue;
    }
    // A spread has runtime-dependent keys and cannot be checked statically.
    // It is intentionally left to the live smoke, which still fails closed.
    return null;
  }
  return keys;
}

function callName(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return null;
}

function loadSmokeProbes(filePath) {
  const source = ts.createSourceFile(
    filePath,
    readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const probes = [];
  const visit = (node) => {
    if (!ts.isCallExpression(node)) {
      ts.forEachChild(node, visit);
      return;
    }

    const name = callName(node.expression);
    const isNamedProbe =
      name === "expectAnonRpcBlocked" || name === "assertRequiredArgumentProbe";
    const isLiteralRpc =
      name === "rpc" && ts.isPropertyAccessExpression(node.expression);
    if ((isNamedProbe || isLiteralRpc) && node.arguments.length >= 2) {
      const rpcName = literalString(node.arguments[0]);
      const inputs = literalObjectKeys(node.arguments[1]);
      if (rpcName && inputs) {
        probes.push({
          name: rpcName,
          inputs,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return probes;
}

const functions = loadDatabaseFunctionInputs(typesPath);
const probes = loadSmokeProbes(smokePath);
if (probes.length === 0) {
  throw new Error(`${smokePath} has no statically checkable RPC probes`);
}

const violations = [];
for (const probe of probes) {
  const expectedInputs = functions.get(probe.name);
  if (!expectedInputs) {
    violations.push(
      `${probe.name} (line ${probe.line}): missing from generated Database.public.Functions`,
    );
    continue;
  }

  const supplied = new Set(probe.inputs);
  const unexpected = probe.inputs.filter((input) => !expectedInputs.has(input));
  const missing = [...expectedInputs]
    .filter(([input, optional]) => !optional && !supplied.has(input))
    .map(([input]) => input);
  if (unexpected.length || missing.length) {
    const detail = [];
    if (missing.length) detail.push(`missing required input(s): ${missing.join(", ")}`);
    if (unexpected.length) detail.push(`unknown input(s): ${unexpected.join(", ")}`);
    violations.push(`${probe.name} (line ${probe.line}): ${detail.join("; ")}`);
  }
}

if (violations.length) {
  console.error("Schema-smoke RPC contract mismatch:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(
  `OK schema smoke RPC contract: verified ${probes.length} literal probes against generated database inputs`,
);
