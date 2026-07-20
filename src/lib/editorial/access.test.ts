import { describe, expect, it } from "vitest";
import { isEditorialAdmin } from "@/lib/editorial/access";

describe("editorial access", () => {
  it("does not grant access to an arbitrary address", () => {
    expect(isEditorialAdmin({ email: "not-an-editor@invalid.test" })).toBe(false);
  });
});
