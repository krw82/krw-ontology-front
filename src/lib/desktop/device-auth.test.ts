import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  approveDesktopDeviceLoginCode,
  authenticateDesktopAccessToken,
  pollDesktopDeviceLogin,
  refreshDesktopTokens,
  revokeDesktopDevice,
  startDesktopDeviceLogin,
  tokenHash,
} from "./device-auth";
import type {
  DesktopAccessTokenRow,
  DesktopDeviceLoginCodeRow,
  DesktopDeviceRow,
  DesktopRefreshTokenRow,
} from "@/types/database";

interface MemoryTables {
  desktop_device_login_codes: DesktopDeviceLoginCodeRow[];
  desktop_devices: DesktopDeviceRow[];
  desktop_access_tokens: DesktopAccessTokenRow[];
  desktop_refresh_tokens: DesktopRefreshTokenRow[];
}

class QueryMock {
  private filters: Array<[string, unknown]> = [];
  private action: "select" | "insert" | "update" = "select";
  private insertRows: Record<string, unknown>[] = [];
  private patch: Record<string, unknown> = {};

  constructor(
    private tables: MemoryTables,
    private table: keyof MemoryTables,
  ) {}

  select() {
    return this;
  }

  insert(value: Record<string, unknown> | Record<string, unknown>[]) {
    this.action = "insert";
    this.insertRows = Array.isArray(value) ? value : [value];
    return this;
  }

  update(value: Record<string, unknown>) {
    this.action = "update";
    this.patch = value;
    return this;
  }

  eq(key: string, value: unknown) {
    this.filters.push([key, value]);
    return this;
  }

  async single<T>() {
    const result = await this.execute();
    return {
      data: (Array.isArray(result.data) ? result.data[0] : result.data) as T,
      error: result.error,
    };
  }

  async maybeSingle<T>() {
    const result = await this.execute();
    const rows = Array.isArray(result.data) ? result.data : [];
    return {
      data: (rows[0] ?? null) as T | null,
      error: result.error,
    };
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    resolve?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return this.execute().then(resolve, reject);
  }

  private async execute() {
    if (this.action === "insert") {
      const rows = this.insertRows.map((row) => this.withDefaults(row));
      this.tables[this.table].push(...(rows as never[]));
      return { data: rows, error: null };
    }

    const rows = this.matchingRows();
    if (this.action === "update") {
      for (const row of rows) Object.assign(row, this.patch);
      return { data: null, error: null };
    }

    return { data: rows, error: null };
  }

  private matchingRows() {
    return this.tables[this.table].filter((row) =>
      this.filters.every(([key, value]) => row[key] === value),
    );
  }

  private withDefaults(row: Record<string, unknown>) {
    const id = `${this.table}-${this.tables[this.table].length + 1}`;
    const now = "2026-06-10T00:00:00.000Z";
    if (this.table === "desktop_device_login_codes") {
      return {
        id,
        status: "pending",
        user_id: null,
        device_id: null,
        approved_at: null,
        consumed_at: null,
        created_at: now,
        updated_at: now,
        ...row,
      };
    }
    if (this.table === "desktop_devices") {
      return {
        id,
        status: "active",
        revoked_at: null,
        created_at: now,
        updated_at: now,
        ...row,
      };
    }
    if (this.table === "desktop_access_tokens") {
      return {
        id,
        status: "active",
        last_used_at: null,
        created_at: now,
        revoked_at: null,
        ...row,
      };
    }
    return {
      id,
      status: "active",
      last_used_at: null,
      created_at: now,
      rotated_at: null,
      revoked_at: null,
      ...row,
    };
  }
}

function createAdmin(tables: MemoryTables) {
  return {
    from(table: keyof MemoryTables) {
      return new QueryMock(tables, table);
    },
  };
}

function createTables(): MemoryTables {
  return {
    desktop_device_login_codes: [],
    desktop_devices: [],
    desktop_access_tokens: [],
    desktop_refresh_tokens: [],
  };
}

const now = new Date("2026-06-10T12:00:00.000Z");

describe("Desktop device auth service", () => {
  let tables: MemoryTables;

  beforeEach(() => {
    vi.clearAllMocks();
    tables = createTables();
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      createAdmin(tables) as unknown as ReturnType<typeof getSupabaseAdmin>,
    );
  });

  it("starts a device login with hashed stored codes only", async () => {
    const start = await startDesktopDeviceLogin({
      deviceName: "MacBook",
      platform: "darwin",
      arch: "arm64",
      appVersion: "0.1.0",
      protocolVersion: "desktop/v1",
      now,
    });

    expect(start.ok).toBe(true);
    expect(start.device_code).toMatch(/^[-_A-Za-z0-9]+$/);
    expect(start.user_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(tables.desktop_device_login_codes).toHaveLength(1);
    expect(tables.desktop_device_login_codes[0]).toMatchObject({
      device_code_hash: tokenHash(start.device_code),
      user_code_hash: tokenHash(start.user_code.replace(/[^a-zA-Z0-9]/g, "")),
      user_code_display: start.user_code,
      device_name: "MacBook",
      protocol_version: "desktop/v1",
      status: "pending",
    });
    expect(JSON.stringify(tables.desktop_device_login_codes[0])).not.toContain(
      start.device_code,
    );
  });

  it("approves and completes device polling with token issuance", async () => {
    const start = await startDesktopDeviceLogin({
      deviceName: "MacBook",
      protocolVersion: "desktop/v1",
      now,
    });

    await approveDesktopDeviceLoginCode({
      userCode: start.user_code,
      userId: "user-1",
      now,
    });
    const result = await pollDesktopDeviceLogin(start.device_code, now);

    expect(result.status).toBe("complete");
    expect(result.device?.id).toBe("desktop_devices-1");
    expect(result.tokens?.desktop_access_token).toMatch(/^krw_dt_/);
    expect(result.tokens?.desktop_refresh_token).toMatch(/^krw_dr_/);
    expect(tables.desktop_devices).toHaveLength(1);
    expect(tables.desktop_access_tokens).toHaveLength(1);
    expect(tables.desktop_refresh_tokens).toHaveLength(1);
    expect(tables.desktop_access_tokens[0].token_hash).toBe(
      tokenHash(result.tokens?.desktop_access_token ?? ""),
    );
    expect(tables.desktop_refresh_tokens[0].token_hash).toBe(
      tokenHash(result.tokens?.desktop_refresh_token ?? ""),
    );
    expect(tables.desktop_device_login_codes[0]).toMatchObject({
      status: "complete",
      user_id: "user-1",
      device_id: "desktop_devices-1",
    });
  });

  it("refreshes tokens by rotating the refresh token", async () => {
    const start = await startDesktopDeviceLogin({
      deviceName: "MacBook",
      protocolVersion: "desktop/v1",
      now,
    });
    await approveDesktopDeviceLoginCode({
      userCode: start.user_code,
      userId: "user-1",
      now,
    });
    const complete = await pollDesktopDeviceLogin(start.device_code, now);
    const refreshed = await refreshDesktopTokens({
      deviceId: complete.device?.id ?? "",
      refreshToken: complete.tokens?.desktop_refresh_token ?? "",
      now: new Date("2026-06-10T12:05:00.000Z"),
    });

    expect(refreshed.desktop_access_token).not.toBe(
      complete.tokens?.desktop_access_token,
    );
    expect(refreshed.desktop_refresh_token).not.toBe(
      complete.tokens?.desktop_refresh_token,
    );
    expect(tables.desktop_refresh_tokens).toHaveLength(2);
    expect(tables.desktop_refresh_tokens[0].status).toBe("rotated");
    expect(tables.desktop_refresh_tokens[1].status).toBe("active");
  });

  it("authenticates active desktop access tokens and rejects revoked devices", async () => {
    const start = await startDesktopDeviceLogin({
      deviceName: "MacBook",
      protocolVersion: "desktop/v1",
      now,
    });
    await approveDesktopDeviceLoginCode({
      userCode: start.user_code,
      userId: "user-1",
      now,
    });
    const complete = await pollDesktopDeviceLogin(start.device_code, now);

    const auth = await authenticateDesktopAccessToken(
      complete.tokens?.desktop_access_token ?? "",
      now,
    );

    expect(auth).toMatchObject({
      userId: "user-1",
      deviceId: "desktop_devices-1",
      authMethod: "desktop_access_token",
    });
    expect(tables.desktop_access_tokens[0].last_used_at).toBe(now.toISOString());

    await revokeDesktopDevice({
      auth: auth!,
      now: new Date("2026-06-10T12:06:00.000Z"),
    });

    await expect(
      authenticateDesktopAccessToken(
        complete.tokens?.desktop_access_token ?? "",
        now,
      ),
    ).rejects.toMatchObject({
      name: "DesktopAuthError",
      status: 401,
    });
    expect(tables.desktop_devices[0].status).toBe("revoked");
    expect(tables.desktop_access_tokens[0].status).toBe("revoked");
    expect(tables.desktop_refresh_tokens[0].status).toBe("revoked");
  });
});
