import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  getReadyRustAgentDaemon,
  rustDaemonHeartbeatRequired,
} from "./daemon-heartbeat";

const descriptorArtifactHash = `sha256:${"a".repeat(64)}`;
const releaseSetHash = `sha256:${"b".repeat(64)}`;

function mockDaemonRow(
  now = new Date(),
  lastSeenAt = now,
  expiresAt = new Date(now.getTime() + 90_000),
) {
  const filters: Array<[string, string, unknown]> = [];
  const query = {
    eq(key: string, value: unknown) {
      filters.push(["eq", key, value]);
      return query;
    },
    gt(key: string, value: unknown) {
      filters.push(["gt", key, value]);
      return query;
    },
    order() {
      return query;
    },
    limit() {
      return query;
    },
    maybeSingle: async () => ({
      data: {
        daemon_id: "mac-agentd-501",
        provider: "deepseek",
        descriptor_artifact_hash: descriptorArtifactHash,
        release_set_hash: releaseSetHash,
        runtime_version: "0.1.0",
        mcp_ready: true,
        last_seen_at: lastSeenAt.toISOString(),
        heartbeat_expires_at: expiresAt.toISOString(),
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      },
      error: null,
    }),
  };
  const admin = {
    from: vi.fn(() => ({
      select: vi.fn(() => query),
    })),
  };
  return { admin, filters };
}

describe("Rust daemon heartbeat admission", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("is disabled by default for local development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("KRW_AGENT_BACKEND_MODE", "rust");

    expect(rustDaemonHeartbeatRequired()).toBe(false);
    await expect(getReadyRustAgentDaemon()).resolves.toEqual({
      ok: true,
      required: false,
      daemon: null,
    });
    expect(getSupabaseAdmin).not.toHaveBeenCalled();
  });

  it("requires an exact fresh receipt directly from the Rust daemon table", async () => {
    const now = new Date("2026-08-12T00:00:00.000Z");
    const fake = mockDaemonRow(now);
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin as never);
    vi.stubEnv("KRW_AGENT_DAEMON_HEARTBEAT_REQUIRED", "1");
    vi.stubEnv("KRW_AGENT_PROVIDER", "deepseek");
    vi.stubEnv("KRW_AGENT_RELEASE_ARTIFACT_HASH", descriptorArtifactHash);
    vi.stubEnv("KRW_AGENT_RELEASE_SET_HASH", releaseSetHash);

    const result = await getReadyRustAgentDaemon(now);

    expect(result).toMatchObject({
      ok: true,
      required: true,
      daemon: { daemon_id: "mac-agentd-501", provider: "deepseek" },
    });
    expect(fake.admin.from).toHaveBeenCalledWith("agent_v1_daemon_heartbeats");
    expect(fake.filters).toEqual(expect.arrayContaining([
      ["eq", "provider", "deepseek"],
      ["eq", "descriptor_artifact_hash", descriptorArtifactHash],
      ["eq", "release_set_hash", releaseSetHash],
      ["eq", "mcp_ready", true],
    ]));
  });

  it("does not admit an old mcp-ready receipt before the database TTL expires", async () => {
    const now = new Date("2026-08-12T00:00:00.000Z");
    const fake = mockDaemonRow(
      now,
      new Date(now.getTime() - 60_000),
      new Date(now.getTime() + 30_000),
    );
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin as never);
    vi.stubEnv("KRW_AGENT_DAEMON_HEARTBEAT_REQUIRED", "1");
    vi.stubEnv("KRW_AGENT_PROVIDER", "deepseek");
    vi.stubEnv("KRW_AGENT_RELEASE_ARTIFACT_HASH", descriptorArtifactHash);
    vi.stubEnv("KRW_AGENT_RELEASE_SET_HASH", releaseSetHash);

    await expect(getReadyRustAgentDaemon(now)).resolves.toEqual({
      ok: false,
      reason: "daemon_unavailable",
      message: "Local Rust research daemon is unavailable",
    });
  });
});
