import { beforeEach, describe, expect, it, vi } from "vitest";

const repositoryMocks = vi.hoisted(() => ({
  getPublishedPulseEditorialEntries: vi.fn(),
  editorialPublicUrl: vi.fn((_supabase: unknown, path: string) => `http://storage.test/${path}`),
}));

vi.mock("@/lib/editorial/repository", () => ({
  getPublishedPulseEditorialEntries: repositoryMocks.getPublishedPulseEditorialEntries,
  editorialPublicUrl: repositoryMocks.editorialPublicUrl,
}));

import { getEditorialLearningCandidates } from "@/lib/pulse/sources/editorial";

describe("Pulse editorial learning source", () => {
  beforeEach(() => {
    repositoryMocks.getPublishedPulseEditorialEntries.mockReset();
    repositoryMocks.editorialPublicUrl.mockClear();
  });

  it("returns only currently published content and keeps carousel order", async () => {
    repositoryMocks.getPublishedPulseEditorialEntries.mockResolvedValue([
      {
        id: "a1b2c3d4-e5f6-4789-abcd-123456789012",
        slug: "apple-services",
        status: "published",
        format: "carousel",
        title: "Apple 서비스 생태계",
        body: "고객 관계를 함께 봅니다.",
        ticker: "AAPL",
        action_label: null,
        action_href: null,
        publish_at: "2026-07-20T00:00:00.000Z",
        expires_at: null,
        created_by: "f1b2c3d4-e5f6-4789-abcd-123456789012",
        created_at: "2026-07-19T00:00:00.000Z",
        updated_at: "2026-07-19T00:00:00.000Z",
        pulse_editorial_assets: [
          { id: "a", entry_id: "a1b2c3d4-e5f6-4789-abcd-123456789012", position: 1, storage_path: "editorial/a/01.png", alt_text: "두 번째", mime_type: "image/png", byte_size: 20, width: null, height: null, created_at: "2026-07-19T00:00:00.000Z" },
          { id: "b", entry_id: "a1b2c3d4-e5f6-4789-abcd-123456789012", position: 0, storage_path: "editorial/a/00.png", alt_text: "첫 번째", mime_type: "image/png", byte_size: 20, width: null, height: null, created_at: "2026-07-19T00:00:00.000Z" },
        ],
      },
      {
        id: "b1b2c3d4-e5f6-4789-abcd-123456789012",
        slug: "draft",
        status: "draft",
        format: "text",
        title: "보이면 안 되는 초안",
        body: "",
        ticker: null,
        action_label: null,
        action_href: null,
        publish_at: null,
        expires_at: null,
        created_by: "f1b2c3d4-e5f6-4789-abcd-123456789012",
        created_at: "2026-07-19T00:00:00.000Z",
        updated_at: "2026-07-19T00:00:00.000Z",
        pulse_editorial_assets: [],
      },
    ]);

    const [candidate] = await getEditorialLearningCandidates({} as never, new Date("2026-07-20T01:00:00.000Z"));

    expect(candidate).toMatchObject({
      kind: "learning",
      ticker: "AAPL",
      title: "Apple 서비스 생태계",
      metadata: {
        learning_kind: "carousel",
        asset_count: 2,
        asset_1: "http://storage.test/editorial/a/00.png",
        asset_alt_1: "첫 번째",
        asset_2: "http://storage.test/editorial/a/01.png",
      },
    });
  });
});
