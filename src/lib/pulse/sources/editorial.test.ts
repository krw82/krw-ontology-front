import { beforeEach, describe, expect, it, vi } from "vitest";

const repositoryMocks = vi.hoisted(() => ({
  getActivePulseEditorialDistributions: vi.fn(),
  getPublishedPulseEditorialEntries: vi.fn(),
  editorialAssetUrl: vi.fn((assetId: string) => `/api/editorial/assets/${assetId}`),
}));

vi.mock("@/lib/editorial/repository", () => ({
  getActivePulseEditorialDistributions: repositoryMocks.getActivePulseEditorialDistributions,
  getPublishedPulseEditorialEntries: repositoryMocks.getPublishedPulseEditorialEntries,
  editorialAssetUrl: repositoryMocks.editorialAssetUrl,
}));

import { getEditorialLearningCandidates } from "@/lib/pulse/sources/editorial";

describe("Pulse editorial learning source", () => {
  beforeEach(() => {
    repositoryMocks.getActivePulseEditorialDistributions.mockReset();
    repositoryMocks.getPublishedPulseEditorialEntries.mockReset();
    repositoryMocks.editorialAssetUrl.mockClear();
    repositoryMocks.getActivePulseEditorialDistributions.mockResolvedValue([]);
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
        asset_1: "/api/editorial/assets/b",
        asset_alt_1: "첫 번째",
        asset_2: "/api/editorial/assets/a",
      },
    });
  });

  it("uses an explicit active distribution for a company story", async () => {
    repositoryMocks.getActivePulseEditorialDistributions.mockResolvedValue([
      {
        id: "d1b2c3d4-e5f6-4789-abcd-123456789012",
        entry_id: "e1b2c3d4-e5f6-4789-abcd-123456789012",
        channel: "pulse",
        status: "active",
        placement: "early",
        priority: 12,
        starts_at: "2026-07-20T00:00:00.000Z",
        ends_at: null,
        created_at: "2026-07-19T00:00:00.000Z",
        pulse_editorial_entries: {
          id: "e1b2c3d4-e5f6-4789-abcd-123456789012",
          slug: "apple-services-ecosystem",
          series_id: "s1b2c3d4-e5f6-4789-abcd-123456789012",
          episode_number: 1,
          company_visible: true,
          status: "published",
          format: "carousel",
          title: "아이폰에서 서비스 생태계로",
          body: "애플을 한 장씩 이해합니다.",
          ticker: "AAPL",
          action_label: null,
          action_href: null,
          publish_at: "2026-07-20T00:00:00.000Z",
          expires_at: null,
          created_at: "2026-07-19T00:00:00.000Z",
          pulse_editorial_assets: [
            { id: "a", position: 0, storage_path: "series/s1b2c3d4-e5f6-4789-abcd-123456789012/episodes/e1b2c3d4-e5f6-4789-abcd-123456789012/slides/00-a1b2c3d4-e5f6-4789-abcd-123456789012.png", alt_text: "첫 번째", width: 1122, height: 1402 },
          ],
          pulse_editorial_series: {
            id: "s1b2c3d4-e5f6-4789-abcd-123456789012",
            ticker: "AAPL",
            slug: "apple-services",
            status: "published",
            title: "애플 서비스 생태계",
            summary: "아이폰 이후의 관계를 봅니다.",
          },
        },
      },
    ]);

    const [candidate] = await getEditorialLearningCandidates({} as never, new Date("2026-07-20T01:00:00.000Z"));

    expect(candidate).toMatchObject({
      item_key: "learning:d1b2c3d4-e5f6-4789-abcd-123456789012",
      source_id: "d1b2c3d4-e5f6-4789-abcd-123456789012",
      ticker: "AAPL",
      metadata: {
        editorial_placement: "early",
        editorial_priority: 12,
        editorial_series_id: "s1b2c3d4-e5f6-4789-abcd-123456789012",
        editorial_entry_id: "e1b2c3d4-e5f6-4789-abcd-123456789012",
        asset_1: "/api/editorial/assets/a",
      },
    });
  });
});
