import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ontology/catalog", () => ({
  getIndexedCompany: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));
vi.mock("@/lib/coverage/repository", () => ({
  setCompanyCoverageLevel: vi.fn(),
}));
vi.mock("@/lib/watchlist/workspace", () => ({
  getCompanyMark: vi.fn(),
  getWatchlistCompanyDetail: vi.fn(),
  listWatchlistOverview: vi.fn(),
}));

import { getIndexedCompany } from "@/lib/ontology/catalog";
import { setCompanyCoverageLevel } from "@/lib/coverage/repository";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getCompanyMark } from "@/lib/watchlist/workspace";
import type { UserResearchNoteRow } from "@/types/database";
import {
  createDesktopNotebookNote,
  updateDesktopNotebookMark,
} from "./notebook-service";

const EXISTING_NOTE: UserResearchNoteRow = {
  id: "20000000-0000-4000-8000-000000000001",
  user_id: "user-1",
  ticker: "AAPL",
  title: "리스크 메모",
  body: "첫째 줄\n둘째 줄",
  note_type: "risk_memo",
  tags: ["risk", "cash flow"],
  source_chat_session_id: null,
  source_message_id: null,
  client_operation_id: "operation-123",
  source_origin: "desktop",
  source_device_id: "device-1",
  source_local_session_id: "local-session",
  source_local_run_id: "local-run",
  source_local_message_id: "local-message",
  created_at: "2026-07-18T00:00:00.000Z",
  updated_at: "2026-07-18T00:00:00.000Z",
};

function noteInput(overrides: Record<string, unknown> = {}) {
  return {
    userId: "user-1",
    deviceId: "  device-1  ",
    ticker: "aapl",
    idempotencyKey: "operation-123",
    body: {
      title: "  리스크   메모  ",
      body: "첫째 줄\r\n둘째 줄",
      note_type: "risk_memo",
      tags: [" risk ", "cash   flow", "risk"],
      localSessionId: " local-session ",
      localRunId: " local-run ",
      localMessageId: " local-message ",
      ...overrides,
    },
  };
}

function createAdmin(existing: UserResearchNoteRow | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: existing, error: null });
  const insert = vi.fn().mockReturnValue({
    select: () => ({
      single: () => Promise.resolve({ data: EXISTING_NOTE, error: null }),
    }),
  });
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle,
    insert,
  } as Record<string, ReturnType<typeof vi.fn>>;
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);

  return {
    admin: {
      from: vi.fn().mockReturnValue(query),
    },
    insert,
    maybeSingle,
  };
}

describe("createDesktopNotebookNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getIndexedCompany).mockResolvedValue({ ticker: "AAPL" } as never);
    vi.mocked(getCompanyMark).mockResolvedValue(null);
  });

  it("returns an existing note only when the normalized request is identical", async () => {
    const fake = createAdmin(EXISTING_NOTE);
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin as never);

    const result = await createDesktopNotebookNote(noteInput());

    expect(result.meta.replayed).toBe(true);
    expect(result.data.note.id).toBe(EXISTING_NOTE.id);
    expect(fake.insert).not.toHaveBeenCalled();
  });

  it("rejects a reused idempotency key when any normalized note payload differs", async () => {
    const fake = createAdmin(EXISTING_NOTE);
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin as never);

    await expect(
      createDesktopNotebookNote(noteInput({ title: "다른 메모" })),
    ).rejects.toMatchObject({
      name: "DesktopContractError",
      code: "idempotency_conflict",
      status: 409,
    });
    expect(fake.insert).not.toHaveBeenCalled();
  });

  it("does not create coverage before inserting a desktop note", async () => {
    const fake = createAdmin(null);
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin as never);

    await createDesktopNotebookNote(noteInput());

    expect(fake.insert).toHaveBeenCalledTimes(1);
  });

  it("forwards an explicit null coverage level to clear a desktop mark", async () => {
    vi.mocked(getCompanyMark).mockResolvedValue({
      user_id: "user-1",
      ticker: "AAPL",
      coverage_level: "holding",
      priority: 0,
      interest_reason: null,
      tags: [],
      last_activity_at: null,
      created_at: "2026-07-20T00:00:00.000Z",
      updated_at: "2026-07-20T00:00:00.000Z",
    });
    vi.mocked(setCompanyCoverageLevel).mockResolvedValue({
      user_id: "user-1",
      ticker: "AAPL",
      coverage_level: null,
      priority: 0,
      interest_reason: null,
      tags: [],
      last_activity_at: null,
      created_at: "2026-07-20T00:00:00.000Z",
      updated_at: "2026-07-20T00:00:00.000Z",
    });

    await updateDesktopNotebookMark({
      userId: "user-1",
      userEmail: null,
      ticker: "AAPL",
      expectedVersion: '"2026-07-20T00:00:00.000Z"',
      body: { coverage_level: null },
    });

    expect(setCompanyCoverageLevel).toHaveBeenCalledWith(
      expect.objectContaining({ coverageLevel: null, ticker: "AAPL" }),
    );
  });
});
