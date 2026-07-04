import { describe, expect, it } from "vitest";
import { serializeJsonLd } from "./JsonLdScript";

describe("serializeJsonLd", () => {
  it("escapes opening angle brackets for safe JSON-LD embedding", () => {
    const result = serializeJsonLd({
      "@context": "https://schema.org",
      name: "KRW <Ontology>",
    });

    expect(result).toContain("\\u003cOntology>");
    expect(result).not.toContain("<Ontology>");
  });
});
