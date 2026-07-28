import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  download: vi.fn(),
  getAuthUser: vi.fn(),
  isEditorialAdmin: vi.fn(),
  isLocalEditorialAdminRequest: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getAuthUser: mocks.getAuthUser }));
vi.mock("@/lib/editorial/access", () => ({
  isEditorialAdmin: mocks.isEditorialAdmin,
  isLocalEditorialAdminRequest: mocks.isLocalEditorialAdminRequest,
}));
vi.mock("@/lib/editorial/repository", () => ({ PULSE_EDITORIAL_BUCKET: "pulse-editorial" }));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: mocks.maybeSingle }),
      }),
    }),
    storage: {
      from: () => ({ download: mocks.download }),
    },
  }),
}));

import { GET } from "./route";

const assetId = "e1b2c3d4-e5f6-4789-abcd-123456789012";

function context() {
  return { params: Promise.resolve({ assetId }) } as never;
}

describe("GET /api/editorial/assets/[assetId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthUser.mockResolvedValue(null);
    mocks.isEditorialAdmin.mockReturnValue(false);
    mocks.isLocalEditorialAdminRequest.mockReturnValue(false);
    mocks.download.mockResolvedValue({ data: new Blob(["image-data"], { type: "image/png" }), error: null });
  });

  it("serves only an already-published public story through the app origin", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: {
        id: assetId,
        storage_path: "series/series-id/episodes/entry-id/slides/00-asset.png",
        mime_type: "image/png",
        byte_size: 10,
        pulse_editorial_entries: {
          series_id: "s1b2c3d4-e5f6-4789-abcd-123456789012",
          company_visible: true,
          status: "published",
          publish_at: "2020-01-01T00:00:00.000Z",
          expires_at: null,
          pulse_editorial_series: { status: "published" },
        },
      },
      error: null,
    });

    const response = await GET(new Request(`http://localhost/api/editorial/assets/${assetId}`), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(await response.text()).toBe("image-data");
    expect(mocks.download).toHaveBeenCalledWith("series/series-id/episodes/entry-id/slides/00-asset.png");
  });

  it("does not disclose a draft asset to a visitor", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: {
        id: assetId,
        storage_path: "series/series-id/episodes/entry-id/slides/00-asset.png",
        mime_type: "image/png",
        byte_size: 10,
        pulse_editorial_entries: {
          series_id: "s1b2c3d4-e5f6-4789-abcd-123456789012",
          company_visible: false,
          status: "draft",
          publish_at: null,
          expires_at: null,
          pulse_editorial_series: { status: "draft" },
        },
      },
      error: null,
    });

    const response = await GET(new Request(`http://localhost/api/editorial/assets/${assetId}`), context());

    expect(response.status).toBe(404);
    expect(mocks.download).not.toHaveBeenCalled();
  });
});
