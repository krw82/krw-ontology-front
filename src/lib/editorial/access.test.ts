import { describe, expect, it } from "vitest";
import { isEditorialAdmin, isLocalEditorialAdminHost, isLocalEditorialAdminRequest } from "@/lib/editorial/access";
import { DEV_AUTH_EMAIL } from "@/lib/dev-auth";

describe("editorial access", () => {
  it("does not grant access to an arbitrary address", () => {
    expect(isEditorialAdmin({ email: "not-an-editor@invalid.test" })).toBe(false);
  });

  it("allows the explicit local development account without widening production access", () => {
    const environment = process.env as Record<string, string | undefined>;
    const previous = environment.NODE_ENV;
    try {
      environment.NODE_ENV = "development";
      expect(isEditorialAdmin({ email: DEV_AUTH_EMAIL })).toBe(true);
    } finally {
      if (previous === undefined) delete environment.NODE_ENV;
      else environment.NODE_ENV = previous;
    }
  });

  it("opens editorial operations only from a local development origin", () => {
    const environment = process.env as Record<string, string | undefined>;
    const previous = environment.NODE_ENV;
    try {
      environment.NODE_ENV = "development";
      expect(isLocalEditorialAdminHost("localhost:3000")).toBe(true);
      expect(isLocalEditorialAdminHost("127.0.0.1:3000")).toBe(true);
      expect(isLocalEditorialAdminHost("krwontology.com")).toBe(false);
      expect(isLocalEditorialAdminRequest(new Request("http://localhost:3000/api/editorial"))).toBe(true);

      environment.NODE_ENV = "production";
      expect(isLocalEditorialAdminHost("localhost:3000")).toBe(false);
    } finally {
      if (previous === undefined) delete environment.NODE_ENV;
      else environment.NODE_ENV = previous;
    }
  });
});
