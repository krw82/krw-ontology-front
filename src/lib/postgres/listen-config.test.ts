import { describe, expect, it } from "vitest";
import { resolvePostgresTls } from "./listen-config";

describe("resolvePostgresTls", () => {
  it("keeps local Supabase on plain TCP", () => {
    expect(resolvePostgresTls("postgres://127.0.0.1:54322/postgres", {
      KRW_RUNTIME_ENVIRONMENT: "prod",
    })).toBeUndefined();
  });

  it("requires a CA bundle for a remote production database", () => {
    expect(() => resolvePostgresTls("postgres://db.example.com/postgres", {
      KRW_RUNTIME_ENVIRONMENT: "prod",
    })).toThrow("agent_v1_database_ca_missing");
  });

  it("verifies a remote production database with the configured CA", () => {
    expect(resolvePostgresTls("postgres://db.example.com/postgres", {
      KRW_RUNTIME_ENVIRONMENT: "prod",
      AGENT_V1_DATABASE_CA_PEM: "-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----",
    })).toEqual({
      ca: "-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----",
      rejectUnauthorized: true,
    });
  });

  it("rejects ambiguous CA configuration", () => {
    expect(() => resolvePostgresTls("postgres://db.example.com/postgres", {
      KRW_RUNTIME_ENVIRONMENT: "prod",
      AGENT_V1_DATABASE_CA_PEM: "pem",
      AGENT_V1_DATABASE_CA_FILE: "/etc/ssl/ca.pem",
    })).toThrow("agent_v1_database_ca_ambiguous");
  });
});
