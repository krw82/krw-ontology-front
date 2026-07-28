import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { forbiddenError, getAuthUser, handleAuthError } from "@/lib/auth";
import { isEditorialAdmin, isLocalEditorialAdminRequest } from "@/lib/editorial/access";
import { PULSE_EDITORIAL_BUCKET, type PulseEditorialSeriesOption } from "@/lib/editorial/repository";
import {
  invalidOriginResponse,
  isExpectedMutationOrigin,
} from "@/lib/filing-notifications/request";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ASSETS = 8;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

const fieldsSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().max(2000).default(""),
  ticker: z.string().trim().toUpperCase().regex(/^[A-Z0-9.]{1,12}$/).optional().or(z.literal("")),
  format: z.enum(["single_image", "carousel", "text"]),
  status: z.enum(["draft", "published"]),
  action_label: z.string().trim().max(80).optional().or(z.literal("")),
  action_href: z.string().trim().max(2000).optional().or(z.literal("")).refine(
    (value) => !value || isSafeEditorialActionHref(value),
    "버튼 링크는 사이트 내부 경로 또는 HTTPS 주소여야 합니다.",
  ),
  publish_at: z.string().trim().optional().or(z.literal("")),
  series_id: z.string().uuid().optional().or(z.literal("")),
  new_series_title: z.string().trim().max(160).optional().or(z.literal("")),
  new_series_summary: z.string().trim().max(2000).optional().or(z.literal("")),
  episode_number: z.union([z.literal(""), z.coerce.number().int().min(1).max(999)]),
  company_visible: z.enum(["true", "false"]),
  distribute_to_pulse: z.enum(["true", "false"]),
  distribution_start_at: z.string().trim().optional().or(z.literal("")),
  distribution_end_at: z.string().trim().optional().or(z.literal("")),
  distribution_placement: z.enum(["early", "standard"]),
  distribution_priority: z.union([z.literal(""), z.coerce.number().int().min(-100).max(100)]),
});

function errorResponse(status: number, message: string) {
  return Response.json({ error: { code: "validation_error", message } }, { status });
}

function storageExtension(fileName: string): string {
  return fileName.toLowerCase().match(/\.(?:jpe?g|png|webp)$/)?.[0] ?? ".png";
}

function legacyStorageFileName(fileName: string, position: number): string {
  return `${String(position).padStart(2, "0")}-image${storageExtension(fileName)}`;
}

function seriesStorageFileName(assetId: string, fileName: string, position: number): string {
  return `${String(position).padStart(2, "0")}-${assetId}${storageExtension(fileName)}`;
}

function slugFor(title: string, id: string, fallback: string): string {
  const normalized = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${normalized || fallback}-${id.slice(0, 8)}`;
}

function isSafeEditorialActionHref(value: string): boolean {
  try {
    const baseUrl = "https://editorial.invalid";
    const parsed = new URL(value, baseUrl);
    return parsed.origin === baseUrl || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function parseDateTime(value: string, label: string, required: boolean): string | null {
  if (!value) {
    if (required) throw new Error(`${label}을 입력해주세요.`);
    return null;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${label} 형식이 올바르지 않습니다.`);
  return new Date(timestamp).toISOString();
}

export async function POST(request: NextRequest) {
  if (!isLocalEditorialAdminRequest(request)) return new Response(null, { status: 404 });
  if (!isExpectedMutationOrigin(request)) return invalidOriginResponse();
  let user;
  try {
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));
  if (!isEditorialAdmin(user)) return forbiddenError("편집 권한이 필요합니다.");

  const formData = await request.formData();
  const fields = fieldsSchema.safeParse({
    title: formData.get("title"),
    body: formData.get("body"),
    ticker: formData.get("ticker"),
    format: formData.get("format"),
    status: formData.get("status"),
    action_label: formData.get("action_label"),
    action_href: formData.get("action_href"),
    publish_at: formData.get("publish_at"),
    series_id: formData.get("series_id") ?? "",
    new_series_title: formData.get("new_series_title") ?? "",
    new_series_summary: formData.get("new_series_summary") ?? "",
    episode_number: formData.get("episode_number") ?? "",
    company_visible: formData.get("company_visible") ?? "false",
    distribute_to_pulse: formData.get("distribute_to_pulse") ?? "false",
    distribution_start_at: formData.get("distribution_start_at") ?? "",
    distribution_end_at: formData.get("distribution_end_at") ?? "",
    distribution_placement: formData.get("distribution_placement") ?? "early",
    distribution_priority: formData.get("distribution_priority") ?? "",
  });
  if (!fields.success) return errorResponse(400, "입력한 콘텐츠 정보를 다시 확인해주세요.");

  const files = formData.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
  if (files.length > MAX_ASSETS) return errorResponse(400, `이미지는 최대 ${MAX_ASSETS}장까지 등록할 수 있습니다.`);
  if (fields.data.format === "text" && files.length > 0) return errorResponse(400, "텍스트 형식에는 이미지를 첨부할 수 없습니다.");
  if (fields.data.format === "single_image" && files.length !== 1) return errorResponse(400, "단일 이미지 형식에는 이미지 1장이 필요합니다.");
  if (fields.data.format === "carousel" && files.length < 2) return errorResponse(400, "캐러셀 형식에는 이미지 2장 이상이 필요합니다.");
  for (const file of files) {
    if (!allowedMimeTypes.has(file.type) || file.size > MAX_IMAGE_BYTES) {
      return errorResponse(400, "JPG, PNG, WebP 이미지만 장당 8MB 이하로 등록할 수 있습니다.");
    }
  }

  const hasSelectedSeries = Boolean(fields.data.series_id);
  const hasNewSeries = Boolean(fields.data.new_series_title);
  const hasSeries = hasSelectedSeries || hasNewSeries;
  if (hasSelectedSeries && hasNewSeries) return errorResponse(400, "기존 시리즈 또는 새 시리즈 중 하나만 선택해주세요.");
  if (hasSeries && fields.data.episode_number === "") return errorResponse(400, "시리즈 에피소드 번호를 입력해주세요.");
  if (fields.data.company_visible === "true" && !hasSeries) {
    return errorResponse(400, "회사 페이지 공개 콘텐츠는 시리즈에 연결해야 합니다.");
  }
  if (fields.data.company_visible === "true" && fields.data.status !== "published") {
    return errorResponse(400, "회사 페이지에 공개하려면 콘텐츠를 발행 상태로 저장해주세요.");
  }
  if (fields.data.distribute_to_pulse === "true" && fields.data.status !== "published") {
    return errorResponse(400, "Pulse에 배포하려면 콘텐츠를 발행 상태로 저장해주세요.");
  }
  if (fields.data.distribute_to_pulse === "true" && !hasSeries) {
    return errorResponse(400, "Pulse 회사 이야기 배포는 시리즈에 연결해야 합니다.");
  }
  if (fields.data.distribute_to_pulse === "true" && fields.data.company_visible !== "true") {
    return errorResponse(400, "Pulse에 배포할 회사 이야기는 회사 페이지에도 공개해야 합니다.");
  }

  let publishAt: string | null;
  let distributionStartAt: string | null;
  let distributionEndAt: string | null;
  try {
    publishAt = parseDateTime(fields.data.publish_at ?? "", "발행 일시", fields.data.status === "published");
    distributionStartAt = parseDateTime(
      fields.data.distribution_start_at ?? "",
      "Pulse 노출 시작 일시",
      fields.data.distribute_to_pulse === "true",
    );
    distributionEndAt = parseDateTime(fields.data.distribution_end_at ?? "", "Pulse 노출 종료 일시", false);
  } catch (error) {
    return errorResponse(400, error instanceof Error ? error.message : "일시를 확인해주세요.");
  }
  if (distributionStartAt && distributionEndAt && Date.parse(distributionEndAt) <= Date.parse(distributionStartAt)) {
    return errorResponse(400, "Pulse 노출 종료 일시는 시작 일시보다 뒤여야 합니다.");
  }

  const admin = getSupabaseAdmin();
  let resolvedTicker = fields.data.ticker || null;
  let seriesId = fields.data.series_id || null;
  let selectedSeries: PulseEditorialSeriesOption | null = null;
  if (seriesId) {
    const { data, error } = await admin
      .from("pulse_editorial_series")
      .select("id, ticker, slug, status, title, summary")
      .eq("id", seriesId)
      .limit(1)
      .returns<PulseEditorialSeriesOption[]>();
    if (error || !data?.[0]) return errorResponse(400, "선택한 시리즈를 찾을 수 없습니다.");
    selectedSeries = data[0];
    if (selectedSeries.status === "archived") return errorResponse(400, "보관된 시리즈에는 새 에피소드를 추가할 수 없습니다.");
    if (resolvedTicker && resolvedTicker !== selectedSeries.ticker) {
      return errorResponse(400, "시리즈의 종목과 입력한 종목이 다릅니다.");
    }
    resolvedTicker = selectedSeries.ticker;
  }
  if (hasNewSeries && !resolvedTicker) return errorResponse(400, "새 회사 시리즈에는 종목 티커가 필요합니다.");

  const entryId = randomUUID();
  if (hasNewSeries) seriesId = randomUUID();
  const episodeNumber = fields.data.episode_number === "" ? null : fields.data.episode_number;
  const companyVisible = hasSeries && fields.data.company_visible === "true";
  const uploadedPaths: string[] = [];
  let insertedEntry = false;
  let insertedSeries = false;
  let distributionId: string | null = null;
  try {
    const assetRows = [];
    for (const [position, file] of files.entries()) {
      const assetId = randomUUID();
      const storagePath = seriesId
        ? `series/${seriesId}/episodes/${entryId}/slides/${seriesStorageFileName(assetId, file.name, position)}`
        : `editorial/${entryId}/${legacyStorageFileName(file.name, position)}`;
      const { error: uploadError } = await admin.storage
        .from(PULSE_EDITORIAL_BUCKET)
        .upload(storagePath, Buffer.from(await file.arrayBuffer()), {
          contentType: file.type,
          cacheControl: "31536000",
          upsert: false,
        });
      if (uploadError) throw uploadError;
      uploadedPaths.push(storagePath);
      const alt = String(formData.get(`alt_${position}`) ?? "").trim();
      assetRows.push({
        id: assetId,
        entry_id: entryId,
        position,
        storage_path: storagePath,
        alt_text: alt || `${fields.data.title} 이미지 ${position + 1}`,
        mime_type: file.type as "image/jpeg" | "image/png" | "image/webp",
        byte_size: file.size,
      });
    }

    if (hasNewSeries && seriesId && resolvedTicker) {
      const { error: seriesError } = await admin.from("pulse_editorial_series").insert({
        id: seriesId,
        ticker: resolvedTicker,
        slug: slugFor(fields.data.new_series_title || fields.data.title, seriesId, "series"),
        status: fields.data.status === "published" && companyVisible ? "published" : "draft",
        title: fields.data.new_series_title || fields.data.title,
        summary: fields.data.new_series_summary || "",
        created_by: user.id,
      });
      if (seriesError) throw seriesError;
      insertedSeries = true;
    }

    const { error: entryError } = await admin.from("pulse_editorial_entries").insert({
      id: entryId,
      series_id: seriesId,
      episode_number: episodeNumber,
      company_visible: companyVisible,
      slug: slugFor(fields.data.title, entryId, "editorial"),
      status: fields.data.status,
      format: fields.data.format,
      title: fields.data.title,
      body: fields.data.body,
      ticker: resolvedTicker,
      action_label: fields.data.action_label || null,
      action_href: fields.data.action_href || null,
      publish_at: publishAt,
      expires_at: null,
      created_by: user.id,
    });
    if (entryError) throw entryError;
    insertedEntry = true;

    if (assetRows.length > 0) {
      const { error: assetsError } = await admin.from("pulse_editorial_assets").insert(assetRows);
      if (assetsError) throw assetsError;
    }

    if (fields.data.distribute_to_pulse === "true" && distributionStartAt) {
      distributionId = randomUUID();
      const { error: distributionError } = await admin.from("pulse_editorial_distributions").insert({
        id: distributionId,
        entry_id: entryId,
        channel: "pulse",
        status: "active",
        placement: fields.data.distribution_placement,
        priority: fields.data.distribution_priority === "" ? 0 : fields.data.distribution_priority,
        starts_at: distributionStartAt,
        ends_at: distributionEndAt,
        created_by: user.id,
      });
      if (distributionError) throw distributionError;
    }

    if (seriesId && fields.data.status === "published" && companyVisible && selectedSeries?.status === "draft") {
      const { error: publishSeriesError } = await admin
        .from("pulse_editorial_series")
        .update({ status: "published" })
        .eq("id", seriesId);
      if (publishSeriesError) throw publishSeriesError;
    }
  } catch {
    if (insertedEntry) {
      try {
        await admin.from("pulse_editorial_entries").delete().eq("id", entryId);
      } catch {
        // Preserve the original failure response; storage cleanup follows.
      }
    }
    if (insertedSeries && seriesId) {
      try {
        await admin.from("pulse_editorial_series").delete().eq("id", seriesId);
      } catch {
        // Preserve the original failure response; storage cleanup follows.
      }
    }
    if (uploadedPaths.length > 0) {
      await admin.storage.from(PULSE_EDITORIAL_BUCKET).remove(uploadedPaths).catch(() => undefined);
    }
    return errorResponse(500, "이미지 콘텐츠를 저장하지 못했습니다. 다시 시도해주세요.");
  }

  return Response.json({ id: entryId, series_id: seriesId, distribution_id: distributionId }, { status: 201 });
}
