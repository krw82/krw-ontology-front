import { describe, expect, it } from "vitest";
import {
  resolveMcpOrigin,
  resolveMcpSessionReuse,
} from "../../../scripts/krw-agent-mcp-contract.mjs";

const registry = `
schema_version: 1
endpoints:
  - endpoint_ref: krw-ontology-local
    origin: https://127.0.0.1
  - endpoint_ref: krw-feed-local
    origin: https://127.0.0.1
  - endpoint_ref: krw-filings-local
    origin: https://127.0.0.1
`;

describe("sealed MCP deployment contract", () => {
  it("uses the one Origin declared by every sealed endpoint", () => {
    expect(resolveMcpOrigin(registry)).toBe("https://127.0.0.1");
  });

  it("rejects endpoint Origin drift instead of choosing one silently", () => {
    expect(() =>
      resolveMcpOrigin(registry.replace("origin: https://127.0.0.1\n  - endpoint_ref: krw-feed", "origin: https://krw-agent.local\n  - endpoint_ref: krw-feed")),
    ).toThrow(/origin/i);
  });

  it("rejects a missing endpoint Origin", () => {
    expect(() => resolveMcpOrigin(registry.replace("    origin: https://127.0.0.1\n", ""))).toThrow(
      /origin/i,
    );
  });

  it("ignores an unrequired legacy endpoint entry", () => {
    expect(resolveMcpOrigin(`${registry}  - endpoint_ref: krw-guru-local\n    origin: https://127.0.0.1\n`)).toBe(
      "https://127.0.0.1",
    );
  });

  it("uses the sealed binding session contract instead of gateway defaults", () => {
    const binding = `
  - binding_key: ontology
    endpoint_ref: krw-ontology-local
    tool_session_reuse: attested-stateless-v1
  - binding_key: guru
    endpoint_ref: krw-ontology-local
    tool_session_reuse: attested-stateless-v1
  - binding_key: feed
    endpoint_ref: krw-feed-local
    tool_session_reuse: run-scoped
  - binding_key: filings
    endpoint_ref: krw-filings-local
    tool_session_reuse: run-scoped
`;
    expect(resolveMcpSessionReuse(binding)).toEqual({
      "krw-ontology-local": "attested-stateless-v1",
      "krw-feed-local": "run-scoped",
      "krw-filings-local": "run-scoped",
    });
  });
});
