import { afterEach, describe, expect, it } from "vitest";
import { isAdminEntitlementEmail } from "./admin-emails";

describe("isAdminEntitlementEmail", () => {
  const originalAdminEmails = process.env.ADMIN_EMAILS;

  afterEach(() => {
    if (originalAdminEmails === undefined) {
      delete process.env.ADMIN_EMAILS;
    } else {
      process.env.ADMIN_EMAILS = originalAdminEmails;
    }
  });

  it("recognizes default development admin emails", () => {
    expect(isAdminEntitlementEmail("admin1@example.com")).toBe(true);
    expect(isAdminEntitlementEmail("admin2@example.com")).toBe(true);
  });

  it("recognizes configured admin emails case-insensitively", () => {
    process.env.ADMIN_EMAILS = "ops@example.com, DEV@example.com";

    expect(isAdminEntitlementEmail("dev@example.com")).toBe(true);
    expect(isAdminEntitlementEmail("ops@example.com")).toBe(true);
    expect(isAdminEntitlementEmail("user@example.com")).toBe(false);
  });
});
