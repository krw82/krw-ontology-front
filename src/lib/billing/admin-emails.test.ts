import { afterEach, describe, expect, it, vi } from "vitest";
import { isAdminEntitlementEmail } from "./admin-emails";

describe("isAdminEntitlementEmail", () => {
  const originalAdminEmails = process.env.ADMIN_EMAILS;

  afterEach(() => {
    vi.unstubAllEnvs();
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

  it("does not use default development admin emails in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ADMIN_EMAILS", "");

    expect(isAdminEntitlementEmail("admin1@example.com")).toBe(false);

    vi.stubEnv("ADMIN_EMAILS", "admin1@example.com");
    expect(isAdminEntitlementEmail("admin1@example.com")).toBe(true);
  });
});
