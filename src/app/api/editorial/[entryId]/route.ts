import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { forbiddenError, getAuthUser, handleAuthError } from "@/lib/auth";
import { isEditorialAdmin, isLocalEditorialAdminRequest } from "@/lib/editorial/access";
import { PULSE_EDITORIAL_BUCKET } from "@/lib/editorial/repository";
import { invalidOriginResponse, isExpectedMutationOrigin } from "@/lib/filing-notifications/request";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  PulseEditorialAssetRow,
  PulseEditorialDistributionRow,
  PulseEditorialEntryRow,
  PulseEditorialSeriesRow,
} from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ASSETS = 8;
const TEMPORARY_POSITION_OFFSET = 16;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const entryIdSchema = z.string().uuid();

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
  episode_number: z.union([z.literal(""), z.coerce.number().int().min(1).max(999)]),
  company_visible: z.enum(["true", "false"]),
  distribute_to_pulse: z.enum(["true", "false"]),
  distribution_start_at: z.string().trim().optional().or(z.literal("")),
  distribution_end_at: z.string().trim().optional().or(z.literal("")),
  distribution_placement: z.enum(["early", "standard"]),
  distribution_priority: z.union([z.literal(""), z.coerce.number().int().min(-100).max(100)]),
});

const assetOrderSchema = z.array(z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existing"), id: z.string().uuid(), alt_text: z.string().trim().max(240) }),
  z.object({ kind: z.literal("new"), upload_index: z.number().int().min(0), alt_text: z.string().trim().max(240) }),
])).max(MAX_ASSETS);

type EditorialEntryForEdit = PulseEditorialEntryRow & {
  pulse_editorial_assets: PulseEditorialAssetRow[];
  pulse_editorial_series: PulseEditorialSeriesRow | null;
  pulse_editorial_distributions: PulseEditorialDistributionRow[];
};

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

async function requireEditorialAdmin(request: NextRequest) {
  if (!isLocalEditorialAdminRequest(request)) return { response: new Response(null, { status: 404 }) } as const;
  if (!isExpectedMutationOrigin(request)) return { response: invalidOriginResponse() } as const;
  try {
    const user = await getAuthUser();
    if (!user) throw new Error("No user");
    if (!isEditorialAdmin(user)) return { response: forbiddenError("편집 권한이 필요합니다.") } as const;
    return { user } as const;
  } catch (error) {
    return { response: handleAuthError(error) } as const;
  }
}

async function getEntry(entryId: string): Promise<EditorialEntryForEdit | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("pulse_editorial_entries")
    .select("*, pulse_editorial_assets(*), pulse_editorial_series(*), pulse_editorial_distributions(*)")
    .eq("id", entryId)
    .maybeSingle<EditorialEntryForEdit>();
  if (error) throw error;
  return data ?? null;
}

function parseAssetOrder(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null;
  try {
    return assetOrderSchema.safeParse(JSON.parse(value));
  } catch {
    return null;
  }
}

function validateImageFiles(files: File[]): string | null {
  if (files.length > MAX_ASSETS) return `이미지는 최대 ${MAX_ASSETS}장까지 등록할 수 있습니다.`;
  for (const file of files) {
    if (!allowedMimeTypes.has(file.type) || file.size > MAX_IMAGE_BYTES) {
      return "JPG, PNG, WebP 이미지만 장당 8MB 이하로 등록할 수 있습니다.";
    }
  }
  return null;
}

export async function PATCH(request: NextRequest, context: RouteContext<"/api/editorial/[entryId]">) {
  const auth = await requireEditorialAdmin(request);
  if ("response" in auth) return auth.response;
  const { entryId } = await context.params;
  if (!entryIdSchema.safeParse(entryId).success) return errorResponse(404, "콘텐츠를 찾을 수 없습니다.");

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
    episode_number: formData.get("episode_number") ?? "",
    company_visible: formData.get("company_visible") ?? "false",
    distribute_to_pulse: formData.get("distribute_to_pulse") ?? "false",
    distribution_start_at: formData.get("distribution_start_at") ?? "",
    distribution_end_at: formData.get("distribution_end_at") ?? "",
    distribution_placement: formData.get("distribution_placement") ?? "early",
    distribution_priority: formData.get("distribution_priority") ?? "",
  });
  if (!fields.success) return errorResponse(400, "입력한 콘텐츠 정보를 다시 확인해주세요.");

  const parsedAssetOrder = parseAssetOrder(formData.get("asset_order"));
  if (!parsedAssetOrder?.success) return errorResponse(400, "슬라이드 순서 정보가 올바르지 않습니다.");
  const newFiles = formData.getAll("new_files").filter((value): value is File => value instanceof File && value.size > 0);
  const imageFileError = validateImageFiles(newFiles);
  if (imageFileError) return errorResponse(400, imageFileError);

  const assets = parsedAssetOrder.data;
  if (fields.data.format === "text" && (assets.length > 0 || newFiles.length > 0)) return errorResponse(400, "텍스트 형식에는 이미지를 첨부할 수 없습니다.");
  if (fields.data.format === "single_image" && assets.length !== 1) return errorResponse(400, "단일 이미지 형식에는 이미지 1장이 필요합니다.");
  if (fields.data.format === "carousel" && assets.length < 2) return errorResponse(400, "캐러셀 형식에는 이미지 2장 이상이 필요합니다.");
  const uploadIndexes = assets.filter((asset) => asset.kind === "new").map((asset) => asset.upload_index);
  if (new Set(uploadIndexes).size !== uploadIndexes.length || uploadIndexes.length !== newFiles.length || uploadIndexes.some((index) => index >= newFiles.length)) {
    return errorResponse(400, "새로 올린 이미지 순서가 올바르지 않습니다.");
  }

  const entry = await getEntry(entryId).catch(() => null);
  if (!entry) return errorResponse(404, "콘텐츠를 찾을 수 없습니다.");
  if (entry.pulse_editorial_assets.length > MAX_ASSETS || entry.pulse_editorial_assets.some((asset) => asset.position >= MAX_ASSETS)) {
    return errorResponse(409, `기존 슬라이드가 ${MAX_ASSETS}장을 초과해 이 화면에서 편집할 수 없습니다.`);
  }
  if ((fields.data.series_id || null) !== entry.series_id) {
    return errorResponse(400, "기존 에피소드의 시리즈는 변경할 수 없습니다. 새 에피소드로 만들어주세요.");
  }

  const existingAssetsById = new Map(entry.pulse_editorial_assets.map((asset) => [asset.id, asset]));
  const existingIds = assets.filter((asset): asset is Extract<typeof asset, { kind: "existing" }> => asset.kind === "existing").map((asset) => asset.id);
  if (new Set(existingIds).size !== existingIds.length || existingIds.some((id) => !existingAssetsById.has(id))) {
    return errorResponse(400, "현재 콘텐츠에 없는 이미지를 수정할 수 없습니다.");
  }

  const hasSeries = entry.series_id !== null;
  if (fields.data.company_visible === "true" && !hasSeries) return errorResponse(400, "회사 페이지 공개 콘텐츠는 시리즈에 연결해야 합니다.");
  if (fields.data.company_visible === "true" && fields.data.status !== "published") return errorResponse(400, "회사 페이지에 공개하려면 콘텐츠를 발행 상태로 저장해주세요.");
  if (fields.data.distribute_to_pulse === "true" && (fields.data.status !== "published" || !hasSeries || fields.data.company_visible !== "true")) {
    return errorResponse(400, "Pulse 배포는 발행된 회사 이야기에서만 사용할 수 있습니다.");
  }

  let publishAt: string | null;
  let distributionStartAt: string | null;
  let distributionEndAt: string | null;
  try {
    publishAt = parseDateTime(fields.data.publish_at ?? "", "발행 일시", fields.data.status === "published");
    distributionStartAt = parseDateTime(fields.data.distribution_start_at ?? "", "Pulse 노출 시작 일시", fields.data.distribute_to_pulse === "true");
    distributionEndAt = parseDateTime(fields.data.distribution_end_at ?? "", "Pulse 노출 종료 일시", false);
  } catch (error) {
    return errorResponse(400, error instanceof Error ? error.message : "일시를 확인해주세요.");
  }
  if (distributionStartAt && distributionEndAt && Date.parse(distributionEndAt) <= Date.parse(distributionStartAt)) {
    return errorResponse(400, "Pulse 노출 종료 일시는 시작 일시보다 뒤여야 합니다.");
  }

  const resolvedTicker = entry.pulse_editorial_series?.ticker ?? (fields.data.ticker || null);
  if (entry.pulse_editorial_series && fields.data.ticker && fields.data.ticker !== entry.pulse_editorial_series.ticker) {
    return errorResponse(400, "시리즈의 종목과 입력한 종목이 다릅니다.");
  }
  const companyVisible = hasSeries && fields.data.company_visible === "true";
  const admin = getSupabaseAdmin();
  const retainedExistingIds = new Set(existingIds);
  const removedAssets = entry.pulse_editorial_assets.filter((asset) => !retainedExistingIds.has(asset.id));
  const uploadedPaths: string[] = [];
  const newAssetRows = new Map<number, PulseEditorialAssetRow>();
  let assetRowsCommitted = false;

  try {
    for (const [uploadIndex, file] of newFiles.entries()) {
      const orderPosition = assets.findIndex((asset) => asset.kind === "new" && asset.upload_index === uploadIndex);
      const assetId = randomUUID();
      const storagePath = entry.series_id
        ? `series/${entry.series_id}/episodes/${entry.id}/slides/${seriesStorageFileName(assetId, file.name, orderPosition)}`
        : `editorial/${entry.id}/${legacyStorageFileName(file.name, orderPosition)}`;
      const { error: uploadError } = await admin.storage
        .from(PULSE_EDITORIAL_BUCKET)
        .upload(storagePath, Buffer.from(await file.arrayBuffer()), {
          contentType: file.type,
          cacheControl: "31536000",
          upsert: false,
        });
      if (uploadError) throw uploadError;
      uploadedPaths.push(storagePath);
      newAssetRows.set(uploadIndex, {
        id: assetId,
        entry_id: entry.id,
        position: orderPosition,
        storage_path: storagePath,
        alt_text: `${fields.data.title} 이미지 ${orderPosition + 1}`,
        mime_type: file.type as PulseEditorialAssetRow["mime_type"],
        byte_size: file.size,
        width: null,
        height: null,
        created_at: new Date().toISOString(),
      });
    }

    const { error: entryError } = await admin
      .from("pulse_editorial_entries")
      .update({
        episode_number: fields.data.episode_number === "" ? null : fields.data.episode_number,
        company_visible: companyVisible,
        status: fields.data.status,
        format: fields.data.format,
        title: fields.data.title,
        body: fields.data.body,
        ticker: resolvedTicker,
        action_label: fields.data.action_label || null,
        action_href: fields.data.action_href || null,
        publish_at: publishAt,
      })
      .eq("id", entry.id);
    if (entryError) throw entryError;

    // Put retained files in a private temporary range before assigning final
    // positions. This preserves immutable asset IDs and avoids unique
    // (entry_id, position) collisions while a user drags slides around.
    for (const [index, assetId] of existingIds.entries()) {
      const { error: temporaryPositionError } = await admin
        .from("pulse_editorial_assets")
        .update({ position: TEMPORARY_POSITION_OFFSET + index })
        .eq("id", assetId)
        .eq("entry_id", entry.id);
      if (temporaryPositionError) throw temporaryPositionError;
    }
    if (removedAssets.length > 0) {
      const { error: removeRowsError } = await admin
        .from("pulse_editorial_assets")
        .delete()
        .in("id", removedAssets.map((asset) => asset.id));
      if (removeRowsError) throw removeRowsError;
    }

    const rowsToInsert = assets.flatMap((asset, position) => {
      if (asset.kind !== "new") return [];
      const row = newAssetRows.get(asset.upload_index);
      if (!row) throw new Error("새 이미지 정보를 찾을 수 없습니다.");
      return [{ ...row, position, alt_text: asset.alt_text || `${fields.data.title} 이미지 ${position + 1}` }];
    });
    if (rowsToInsert.length > 0) {
      const { error: insertAssetsError } = await admin.from("pulse_editorial_assets").insert(rowsToInsert);
      if (insertAssetsError) throw insertAssetsError;
    }
    for (const [position, asset] of assets.entries()) {
      if (asset.kind !== "existing") continue;
      const { error: restorePositionError } = await admin
        .from("pulse_editorial_assets")
        .update({ position, alt_text: asset.alt_text || `${fields.data.title} 이미지 ${position + 1}` })
        .eq("id", asset.id)
        .eq("entry_id", entry.id);
      if (restorePositionError) throw restorePositionError;
    }
    assetRowsCommitted = true;

    const existingDistributions = entry.pulse_editorial_distributions.filter((distribution) => distribution.channel === "pulse");
    if (fields.data.distribute_to_pulse === "true" && distributionStartAt) {
      const primaryDistribution = existingDistributions.find((distribution) => distribution.status === "active") ?? existingDistributions[0];
      const distributionValues = {
        status: "active" as const,
        placement: fields.data.distribution_placement,
        priority: fields.data.distribution_priority === "" ? 0 : fields.data.distribution_priority,
        starts_at: distributionStartAt,
        ends_at: distributionEndAt,
      };
      if (primaryDistribution) {
        const { error: distributionError } = await admin
          .from("pulse_editorial_distributions")
          .update(distributionValues)
          .eq("id", primaryDistribution.id);
        if (distributionError) throw distributionError;
        const redundantIds = existingDistributions.filter((distribution) => distribution.id !== primaryDistribution.id && distribution.status !== "archived").map((distribution) => distribution.id);
        if (redundantIds.length > 0) await admin.from("pulse_editorial_distributions").update({ status: "archived" }).in("id", redundantIds);
      } else {
        const { error: distributionError } = await admin.from("pulse_editorial_distributions").insert({
          id: randomUUID(),
          entry_id: entry.id,
          channel: "pulse",
          ...distributionValues,
          created_by: auth.user.id,
        });
        if (distributionError) throw distributionError;
      }
    } else if (existingDistributions.length > 0) {
      const { error: archiveDistributionError } = await admin
        .from("pulse_editorial_distributions")
        .update({ status: "archived" })
        .in("id", existingDistributions.map((distribution) => distribution.id));
      if (archiveDistributionError) throw archiveDistributionError;
    }

    if (entry.series_id && fields.data.status === "published" && companyVisible && entry.pulse_editorial_series?.status === "draft") {
      const { error: publishSeriesError } = await admin
        .from("pulse_editorial_series")
        .update({ status: "published" })
        .eq("id", entry.series_id);
      if (publishSeriesError) throw publishSeriesError;
    }
  } catch (error) {
    if (!assetRowsCommitted && uploadedPaths.length > 0) {
      await admin.storage.from(PULSE_EDITORIAL_BUCKET).remove(uploadedPaths).catch(() => undefined);
    }
    const message = (error as { code?: string } | null)?.code === "23505"
      ? "같은 시리즈 안에 이미 사용 중인 에피소드 번호입니다."
      : "회사 이야기를 저장하지 못했습니다. 다시 시도해주세요.";
    return errorResponse(500, message);
  }

  if (removedAssets.length > 0) {
    await admin.storage.from(PULSE_EDITORIAL_BUCKET).remove(removedAssets.map((asset) => asset.storage_path)).catch(() => undefined);
  }
  return Response.json({ id: entry.id });
}

export async function DELETE(request: NextRequest, context: RouteContext<"/api/editorial/[entryId]">) {
  const auth = await requireEditorialAdmin(request);
  if ("response" in auth) return auth.response;
  const { entryId } = await context.params;
  if (!entryIdSchema.safeParse(entryId).success) return errorResponse(404, "콘텐츠를 찾을 수 없습니다.");
  const entry = await getEntry(entryId).catch(() => null);
  if (!entry) return errorResponse(404, "콘텐츠를 찾을 수 없습니다.");

  const { error } = await getSupabaseAdmin()
    .from("pulse_editorial_entries")
    .delete()
    .eq("id", entry.id);
  if (error) return errorResponse(500, "콘텐츠를 삭제하지 못했습니다.");
  if (entry.pulse_editorial_assets.length > 0) {
    await getSupabaseAdmin()
      .storage
      .from(PULSE_EDITORIAL_BUCKET)
      .remove(entry.pulse_editorial_assets.map((asset) => asset.storage_path))
      .catch(() => undefined);
  }
  return new Response(null, { status: 204 });
}
