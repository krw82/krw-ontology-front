"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type EditorialFormat = "single_image" | "carousel" | "text";
type EditorialStatus = "draft" | "published";
type SeriesMode = "none" | "existing" | "new";
type DistributionPlacement = "early" | "standard";

export interface EditorialSeriesOption {
  id: string;
  ticker: string;
  slug: string;
  status: "draft" | "published" | "archived";
  title: string;
  summary: string;
}

export interface EditorialExistingAsset {
  id: string;
  src: string;
  altText: string;
  width: number | null;
  height: number | null;
}

export interface EditorialEntryInitialValue {
  id: string;
  seriesId: string | null;
  episodeNumber: number | null;
  companyVisible: boolean;
  title: string;
  body: string;
  ticker: string | null;
  format: EditorialFormat;
  status: EditorialStatus;
  actionLabel: string | null;
  actionHref: string | null;
  publishAt: string | null;
  assets: EditorialExistingAsset[];
  distribution: {
    id: string;
    status: "draft" | "active" | "paused" | "archived";
    placement: DistributionPlacement;
    priority: number;
    startsAt: string | null;
    endsAt: string | null;
  } | null;
}

interface EditorialEntryFormProps {
  seriesOptions: EditorialSeriesOption[];
  initialValue?: EditorialEntryInitialValue;
}

interface ExistingSlide {
  kind: "existing";
  key: string;
  assetId: string;
  src: string;
  altText: string;
}

interface NewSlide {
  kind: "new";
  key: string;
  file: File;
  src: string;
  altText: string;
}

type EditorialSlide = ExistingSlide | NewSlide;

const MAX_ASSETS = 8;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function toDateTimeInput(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const twoDigits = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}T${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;
}

function nowForDateTimeInput(): string {
  return toDateTimeInput(new Date().toISOString());
}

function initialSlides(value?: EditorialEntryInitialValue): EditorialSlide[] {
  return (value?.assets ?? []).map((asset) => ({
    kind: "existing",
    key: `existing-${asset.id}`,
    assetId: asset.id,
    src: asset.src,
    altText: asset.altText,
  }));
}

function isImageFile(value: File): boolean {
  return ACCEPTED_IMAGE_TYPES.has(value.type) && value.size > 0 && value.size <= MAX_IMAGE_BYTES;
}

/**
 * The create and edit views intentionally share one form so a slide is edited
 * exactly once, then reused by both the company page and Pulse distribution.
 */
export default function EditorialEntryForm({ seriesOptions, initialValue }: EditorialEntryFormProps) {
  const router = useRouter();
  const isEditing = Boolean(initialValue);
  const initialDistribution = initialValue?.distribution;
  const blobUrls = useRef(new Set<string>());
  const [format, setFormat] = useState<EditorialFormat>(initialValue?.format ?? "carousel");
  const [status, setStatus] = useState<EditorialStatus>(initialValue?.status ?? "draft");
  const [slides, setSlides] = useState<EditorialSlide[]>(() => initialSlides(initialValue));
  const [title, setTitle] = useState(initialValue?.title ?? "");
  const [body, setBody] = useState(initialValue?.body ?? "");
  const [ticker, setTicker] = useState(initialValue?.ticker ?? "");
  const [publishAt, setPublishAt] = useState(toDateTimeInput(initialValue?.publishAt));
  const [actionLabel, setActionLabel] = useState(initialValue?.actionLabel ?? "");
  const [actionHref, setActionHref] = useState(initialValue?.actionHref ?? "");
  const [seriesMode, setSeriesMode] = useState<SeriesMode>(initialValue?.seriesId ? "existing" : isEditing ? "none" : "new");
  const [seriesId, setSeriesId] = useState(initialValue?.seriesId ?? "");
  const [newSeriesTitle, setNewSeriesTitle] = useState("");
  const [newSeriesSummary, setNewSeriesSummary] = useState("");
  const [episodeNumber, setEpisodeNumber] = useState(initialValue?.episodeNumber ? String(initialValue.episodeNumber) : "1");
  const [companyVisible, setCompanyVisible] = useState(initialValue?.companyVisible ?? true);
  const [distributeToPulse, setDistributeToPulse] = useState(initialDistribution?.status === "active");
  const [distributionStartAt, setDistributionStartAt] = useState(toDateTimeInput(initialDistribution?.startsAt));
  const [distributionEndAt, setDistributionEndAt] = useState(toDateTimeInput(initialDistribution?.endsAt));
  const [distributionPlacement, setDistributionPlacement] = useState<DistributionPlacement>(initialDistribution?.placement ?? "early");
  const [distributionPriority, setDistributionPriority] = useState(String(initialDistribution?.priority ?? 0));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedSeries = useMemo(
    () => seriesOptions.find((series) => series.id === seriesId) ?? null,
    [seriesId, seriesOptions],
  );
  const isSeriesEpisode = seriesMode !== "none";
  const displaySlide = slides[0] ?? null;

  useEffect(() => () => {
    for (const url of blobUrls.current) URL.revokeObjectURL(url);
  }, []);

  function releaseRemovedPreviews(current: EditorialSlide[], next: EditorialSlide[]) {
    const retained = new Set(next.filter((slide): slide is NewSlide => slide.kind === "new").map((slide) => slide.src));
    for (const slide of current) {
      if (slide.kind === "new" && !retained.has(slide.src)) {
        URL.revokeObjectURL(slide.src);
        blobUrls.current.delete(slide.src);
      }
    }
  }

  function replaceSlides(next: EditorialSlide[]) {
    releaseRemovedPreviews(slides, next);
    setSlides(next);
  }

  function createNewSlide(file: File): NewSlide {
    const src = URL.createObjectURL(file);
    blobUrls.current.add(src);
    return {
      kind: "new",
      key: `new-${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
      file,
      src,
      altText: "",
    };
  }

  function addFiles(nextFiles: FileList | File[]) {
    const source = Array.from(nextFiles);
    const invalid = source.find((file) => !isImageFile(file));
    if (invalid) {
      setError("JPG, PNG, WebP 이미지만 장당 8MB 이하로 등록할 수 있습니다.");
      return;
    }
    const additions = source.map(createNewSlide);
    const base = format === "single_image" ? [] : slides;
    const next = [...base, ...additions].slice(0, format === "single_image" ? 1 : MAX_ASSETS);
    if (base.length + additions.length > (format === "single_image" ? 1 : MAX_ASSETS)) {
      setError(format === "single_image" ? "단일 이미지에는 사진 한 장만 사용할 수 있습니다." : `슬라이드는 최대 ${MAX_ASSETS}장까지 등록할 수 있습니다.`);
    } else {
      setError(null);
    }
    replaceSlides(next);
  }

  function moveSlide(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= slides.length) return;
    const next = [...slides];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setSlides(next);
  }

  function updateSlideAlt(index: number, altText: string) {
    setSlides((current) => current.map((slide, slideIndex) => slideIndex === index ? { ...slide, altText } : slide));
  }

  function selectFormat(nextFormat: EditorialFormat) {
    setFormat(nextFormat);
    if (nextFormat === "text") {
      replaceSlides([]);
    } else if (nextFormat === "single_image" && slides.length > 1) {
      replaceSlides(slides.slice(0, 1));
    }
  }

  function chooseSeriesMode(nextMode: SeriesMode) {
    if (isEditing) return;
    setSeriesMode(nextMode);
    if (nextMode === "none") {
      setCompanyVisible(false);
      setDistributeToPulse(false);
      setSeriesId("");
      return;
    }
    setCompanyVisible(true);
  }

  function chooseExistingSeries(nextId: string) {
    setSeriesId(nextId);
    const series = seriesOptions.find((candidate) => candidate.id === nextId);
    if (series) setTicker(series.ticker);
  }

  function chooseStatus(nextStatus: EditorialStatus) {
    setStatus(nextStatus);
    if (nextStatus === "published" && !publishAt) setPublishAt(nowForDateTimeInput());
    if (nextStatus !== "published") setDistributeToPulse(false);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData();
    formData.set("title", title);
    formData.set("body", body);
    formData.set("ticker", ticker.toUpperCase());
    formData.set("format", format);
    formData.set("status", status);
    formData.set("publish_at", publishAt);
    formData.set("action_label", actionLabel);
    formData.set("action_href", actionHref);
    formData.set("series_id", seriesMode === "existing" ? seriesId : "");
    formData.set("new_series_title", !isEditing && seriesMode === "new" ? newSeriesTitle : "");
    formData.set("new_series_summary", !isEditing && seriesMode === "new" ? newSeriesSummary : "");
    formData.set("episode_number", isSeriesEpisode ? episodeNumber : "");
    formData.set("company_visible", String(isSeriesEpisode && companyVisible));
    formData.set("distribute_to_pulse", String(isSeriesEpisode && companyVisible && distributeToPulse));
    formData.set("distribution_start_at", distributeToPulse ? distributionStartAt : "");
    formData.set("distribution_end_at", distributeToPulse ? distributionEndAt : "");
    formData.set("distribution_placement", distributionPlacement);
    formData.set("distribution_priority", distributionPriority);

    if (isEditing) {
      const newSlides = slides.filter((slide): slide is NewSlide => slide.kind === "new");
      formData.set("asset_order", JSON.stringify(slides.map((slide) => slide.kind === "existing"
        ? { kind: "existing", id: slide.assetId, alt_text: slide.altText }
        : { kind: "new", upload_index: newSlides.findIndex((candidate) => candidate.key === slide.key), alt_text: slide.altText },
      )));
      newSlides.forEach((slide) => formData.append("new_files", slide.file));
    } else {
      slides.forEach((slide, index) => {
        if (slide.kind !== "new") return;
        formData.append("files", slide.file);
        formData.set(`alt_${index}`, slide.altText);
      });
    }

    setPending(true);
    try {
      const response = await fetch(isEditing ? `/api/editorial/${initialValue?.id ?? ""}` : "/api/editorial", {
        method: isEditing ? "PATCH" : "POST",
        body: formData,
      });
      const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(payload?.error?.message ?? "콘텐츠를 저장하지 못했습니다.");
      router.push("/admin/editorial");
      router.refresh();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "콘텐츠를 저장하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  async function deleteEntry() {
    if (!initialValue || pending) return;
    if (!window.confirm("이 회사 이야기와 연결된 Pulse 배포를 삭제할까요? 삭제한 사진은 복구할 수 없습니다.")) return;
    setError(null);
    setPending(true);
    try {
      const response = await fetch(`/api/editorial/${initialValue.id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(payload?.error?.message ?? "콘텐츠를 삭제하지 못했습니다.");
      router.push("/admin/editorial");
      router.refresh();
    } catch (deletionError) {
      setError(deletionError instanceof Error ? deletionError.message : "콘텐츠를 삭제하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-xl lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="space-y-lg rounded-[18px] border border-hairline bg-white p-lg shadow-[0_12px_36px_rgba(16,24,40,0.055)] sm:p-xl">
        <div className="border-b border-hairline pb-lg">
          <p className="text-[12px] font-black uppercase tracking-[0.14em] text-primary">Company story</p>
          <h2 className="mt-1 text-[18px] font-black text-ink">{isEditing ? "회사 이야기 편집" : "원본 콘텐츠"}</h2>
          <p className="mt-1 text-[13px] leading-5 text-muted">사진을 한 번 관리하면 회사 페이지와 Pulse가 같은 슬라이드를 사용합니다.</p>
        </div>

        <div className="grid gap-base sm:grid-cols-[minmax(0,1fr)_180px]">
          <label className="block">
            <span className="text-[12px] font-black text-ink">시리즈 연결</span>
            <select
              disabled={isEditing}
              value={seriesMode === "existing" ? seriesId : seriesMode}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "none" || value === "new") chooseSeriesMode(value);
                else {
                  chooseSeriesMode("existing");
                  chooseExistingSeries(value);
                }
              }}
              className="mt-xs min-h-12 w-full rounded-[10px] border border-hairline bg-white px-sm text-[14px] font-bold outline-none focus:border-primary disabled:cursor-not-allowed disabled:bg-surface-soft"
            >
              {!isEditing ? <><option value="new">새 회사 이야기 시리즈</option><option value="none">시리즈 없이 단독 콘텐츠</option></> : null}
              {seriesOptions.map((series) => <option key={series.id} value={series.id}>{series.ticker} · {series.title}{series.status === "archived" ? " (보관)" : ""}</option>)}
            </select>
            {isEditing ? <span className="mt-1 block text-[11px] text-muted">시리즈 변경은 새 에피소드로 만들어 흐름을 보존합니다.</span> : null}
          </label>
          {isSeriesEpisode ? <label className="block">
            <span className="text-[12px] font-black text-ink">에피소드 순서</span>
            <input required type="number" min="1" max="999" value={episodeNumber} onChange={(event) => setEpisodeNumber(event.target.value)} className="mt-xs min-h-12 w-full rounded-[10px] border border-hairline px-sm text-[14px] font-bold outline-none focus:border-primary" />
          </label> : null}
        </div>

        {!isEditing && seriesMode === "new" ? <div className="grid gap-base rounded-[12px] border border-primary/20 bg-primary-fixed/35 p-base sm:grid-cols-2">
          <label className="block"><span className="text-[12px] font-black text-ink">새 시리즈 제목</span><input required value={newSeriesTitle} onChange={(event) => setNewSeriesTitle(event.target.value)} maxLength={160} placeholder="예: 아이폰 너머의 애플" className="mt-xs min-h-11 w-full rounded-[9px] border border-hairline bg-white px-sm text-[14px] font-bold outline-none focus:border-primary" /></label>
          <label className="block"><span className="text-[12px] font-black text-ink">시리즈 소개 (선택)</span><input value={newSeriesSummary} onChange={(event) => setNewSeriesSummary(event.target.value)} maxLength={2000} placeholder="회사 페이지에 보일 한 줄 설명" className="mt-xs min-h-11 w-full rounded-[9px] border border-hairline bg-white px-sm text-[14px] outline-none focus:border-primary" /></label>
        </div> : null}
        {selectedSeries ? <p className="rounded-[10px] bg-surface-soft px-sm py-sm text-[12px] leading-5 text-body"><strong className="font-extrabold text-ink">{selectedSeries.ticker} · {selectedSeries.title}</strong>{selectedSeries.summary ? ` — ${selectedSeries.summary}` : ""}</p> : null}

        <div className="grid gap-base sm:grid-cols-2">
          <label className="block"><span className="text-[12px] font-black text-ink">에피소드 제목</span><input required value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} placeholder="예: 아이폰 판매량보다 서비스가 중요한 이유" className="mt-xs min-h-12 w-full rounded-[10px] border border-hairline px-sm text-[15px] font-bold outline-none focus:border-primary" /></label>
          <label className="block"><span className="text-[12px] font-black text-ink">연결 종목 {seriesMode === "new" ? "" : "(선택)"}</span><input required={seriesMode === "new"} value={ticker} readOnly={seriesMode === "existing"} onChange={(event) => setTicker(event.target.value.toUpperCase())} maxLength={12} placeholder="AAPL" className="mt-xs min-h-12 w-full rounded-[10px] border border-hairline px-sm text-[14px] font-bold uppercase outline-none focus:border-primary read-only:bg-surface-soft" /></label>
        </div>
        <label className="block"><span className="text-[12px] font-black text-ink">요약</span><textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={2000} rows={3} placeholder="회사 페이지와 Pulse 카드의 짧은 소개 문구입니다." className="mt-xs w-full rounded-[10px] border border-hairline px-sm py-sm text-[14px] leading-6 outline-none focus:border-primary" /></label>

        <div className="grid gap-base sm:grid-cols-2">
          <label className="block"><span className="text-[12px] font-black text-ink">콘텐츠 형식</span><select value={format} onChange={(event) => selectFormat(event.target.value as EditorialFormat)} className="mt-xs min-h-12 w-full rounded-[10px] border border-hairline bg-white px-sm text-[14px] font-bold outline-none focus:border-primary"><option value="single_image">단일 이미지</option><option value="carousel">이미지 캐러셀</option><option value="text">텍스트</option></select></label>
          {isSeriesEpisode ? <label className="mt-6 flex min-h-12 items-center gap-sm rounded-[10px] border border-hairline px-sm text-[13px] font-bold text-ink"><input type="checkbox" checked={companyVisible} onChange={(event) => { setCompanyVisible(event.target.checked); if (!event.target.checked) setDistributeToPulse(false); }} className="h-4 w-4 accent-primary" />회사 페이지에 공개</label> : null}
        </div>

        {format !== "text" ? <section>
          <div className="flex items-end justify-between gap-sm"><div><p className="text-[12px] font-black text-ink">슬라이드 이미지</p><p className="mt-0.5 text-[12px] text-muted">JPG, PNG, WebP · 장당 8MB · 최대 {MAX_ASSETS}장 · 권장 4:5</p></div><label className="inline-flex min-h-10 cursor-pointer items-center rounded-[9px] bg-ink px-sm text-[12px] font-extrabold text-white hover:bg-primary">이미지 추가<input type="file" accept="image/jpeg,image/png,image/webp" multiple={format === "carousel"} className="sr-only" onChange={(event) => event.currentTarget.files && addFiles(event.currentTarget.files)} /></label></div>
          <div onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files); }} className="mt-sm rounded-[12px] border border-dashed border-[#b9c4d7] bg-surface-soft p-sm">
            {slides.length === 0 ? <p className="grid min-h-32 place-items-center text-center text-[13px] font-semibold text-muted">이미지를 이곳으로 끌어오거나 ‘이미지 추가’를 선택하세요.</p> : <div className="grid gap-sm sm:grid-cols-2">{slides.map((slide, index) => <div key={slide.key} className="overflow-hidden rounded-[10px] border border-hairline bg-white"><img src={slide.src} alt="업로드 미리보기" className="aspect-[4/5] w-full object-cover" /><div className="space-y-xs p-sm"><div className="flex items-center justify-between gap-xs"><span className="truncate text-[12px] font-bold text-ink">{index + 1}. {slide.kind === "new" ? slide.file.name : "저장된 이미지"}</span><button type="button" onClick={() => replaceSlides(slides.filter((_, slideIndex) => slideIndex !== index))} className="text-[12px] font-bold text-[#c43c22]">삭제</button></div><input value={slide.altText} onChange={(event) => updateSlideAlt(index, event.target.value)} maxLength={240} placeholder="슬라이드 대체 텍스트" className="min-h-10 w-full rounded-[8px] border border-hairline px-xs text-[12px] outline-none focus:border-primary" />{format === "carousel" ? <div className="flex gap-xs"><button type="button" onClick={() => moveSlide(index, -1)} disabled={index === 0} className="text-[12px] font-bold text-primary disabled:text-muted">앞으로</button><button type="button" onClick={() => moveSlide(index, 1)} disabled={index === slides.length - 1} className="text-[12px] font-bold text-primary disabled:text-muted">뒤로</button></div> : null}</div></div>)}</div>}
          </div>
        </section> : null}

        <details className="rounded-[10px] border border-hairline bg-surface-soft p-sm"><summary className="cursor-pointer text-[12px] font-extrabold text-ink">선택 액션 링크</summary><div className="mt-sm grid gap-base sm:grid-cols-2"><label className="block"><span className="text-[12px] font-black text-ink">버튼 문구</span><input value={actionLabel} onChange={(event) => setActionLabel(event.target.value)} maxLength={80} placeholder="예: Apple 리서치 보기" className="mt-xs min-h-10 w-full rounded-[8px] border border-hairline bg-white px-sm text-[13px] outline-none focus:border-primary" /></label><label className="block"><span className="text-[12px] font-black text-ink">버튼 링크</span><input value={actionHref} onChange={(event) => setActionHref(event.target.value)} maxLength={2000} placeholder="/ko/companies/AAPL" className="mt-xs min-h-10 w-full rounded-[8px] border border-hairline bg-white px-sm text-[13px] outline-none focus:border-primary" /></label></div></details>
      </section>

      <aside className="h-fit space-y-base rounded-[18px] border border-hairline bg-white p-lg shadow-[0_12px_36px_rgba(16,24,40,0.055)]">
        <div><p className="text-[12px] font-black text-ink">발행 상태</p><div className="mt-xs grid grid-cols-2 rounded-[10px] bg-surface-soft p-1"><button type="button" onClick={() => chooseStatus("draft")} className={`min-h-10 rounded-[8px] text-[12px] font-extrabold ${status === "draft" ? "bg-white text-ink shadow-sm" : "text-muted"}`}>초안</button><button type="button" onClick={() => chooseStatus("published")} className={`min-h-10 rounded-[8px] text-[12px] font-extrabold ${status === "published" ? "bg-white text-ink shadow-sm" : "text-muted"}`}>발행</button></div></div>
        <label className="block"><span className="text-[12px] font-black text-ink">발행 일시{status === "published" ? "" : " (선택)"}</span><input required={status === "published"} type="datetime-local" value={publishAt} onChange={(event) => setPublishAt(event.target.value)} className="mt-xs min-h-12 w-full rounded-[10px] border border-hairline px-sm text-[13px] outline-none focus:border-primary" /></label>

        {isSeriesEpisode ? <section className="space-y-sm rounded-[12px] border border-primary/20 bg-primary-fixed/35 p-sm"><div className="flex items-start gap-sm"><input id="pulse-distribution" type="checkbox" checked={distributeToPulse} disabled={!companyVisible || status !== "published"} onChange={(event) => setDistributeToPulse(event.target.checked)} className="mt-0.5 h-4 w-4 accent-primary disabled:opacity-50" /><label htmlFor="pulse-distribution" className="text-[12px] font-extrabold leading-5 text-ink">Pulse 첫 피드에 배포</label></div><p className="text-[11px] leading-5 text-body">긴급 공시와 진행 중 리서치 뒤의 2~3번째 자리를 사용합니다. 콘텐츠 원본은 회사 페이지와 같습니다.</p>{distributeToPulse ? <div className="space-y-sm border-t border-primary/15 pt-sm"><label className="block"><span className="text-[11px] font-bold text-ink">노출 시작</span><input required type="datetime-local" value={distributionStartAt} onChange={(event) => setDistributionStartAt(event.target.value)} className="mt-1 min-h-10 w-full rounded-[8px] border border-hairline bg-white px-xs text-[12px] outline-none focus:border-primary" /></label><label className="block"><span className="text-[11px] font-bold text-ink">노출 종료 (선택)</span><input type="datetime-local" value={distributionEndAt} onChange={(event) => setDistributionEndAt(event.target.value)} className="mt-1 min-h-10 w-full rounded-[8px] border border-hairline bg-white px-xs text-[12px] outline-none focus:border-primary" /></label><div className="grid grid-cols-2 gap-xs"><label className="block"><span className="text-[11px] font-bold text-ink">위치</span><select value={distributionPlacement} onChange={(event) => setDistributionPlacement(event.target.value as DistributionPlacement)} className="mt-1 min-h-10 w-full rounded-[8px] border border-hairline bg-white px-xs text-[12px] outline-none focus:border-primary"><option value="early">초기 2~3번째</option><option value="standard">일반 학습 카드</option></select></label><label className="block"><span className="text-[11px] font-bold text-ink">우선순위</span><input type="number" min="-100" max="100" value={distributionPriority} onChange={(event) => setDistributionPriority(event.target.value)} className="mt-1 min-h-10 w-full rounded-[8px] border border-hairline bg-white px-xs text-[12px] outline-none focus:border-primary" /></label></div></div> : null}</section> : null}
        {!isSeriesEpisode ? <p className="rounded-[10px] bg-surface-soft p-sm text-[12px] leading-5 text-body">시리즈 없는 단독 콘텐츠는 기존 Pulse 학습 카드 방식으로만 발행됩니다.</p> : null}
        <section className="overflow-hidden rounded-[12px] border border-hairline bg-surface-soft"><p className="px-sm pt-sm text-[11px] font-black text-muted">모바일 첫 장 미리보기</p><div className="m-sm overflow-hidden rounded-[9px] bg-[#eef2f8]">{displaySlide ? <img src={displaySlide.src} alt="첫 슬라이드 미리보기" className="aspect-[4/5] w-full object-cover" /> : <div className="grid aspect-[4/5] place-items-center px-base text-center text-[12px] font-semibold text-muted">사진을 추가하면 첫 장을 확인할 수 있습니다.</div>}</div><p className="px-sm pb-sm text-[12px] font-black text-ink">{title || "에피소드 제목"}</p></section>
        {error ? <p role="alert" className="rounded-[10px] bg-[#fff1ed] p-sm text-[12px] font-semibold text-[#a33520]">{error}</p> : null}
        <button disabled={pending} className="inline-flex min-h-12 w-full items-center justify-center rounded-[10px] bg-ink px-base text-[13px] font-extrabold text-white hover:bg-primary disabled:opacity-50">{pending ? "저장 중…" : status === "published" ? isEditing ? "변경 사항 발행" : "발행하기" : isEditing ? "변경 사항 저장" : "초안 저장"}</button>
        {isEditing ? <button type="button" disabled={pending} onClick={deleteEntry} className="inline-flex min-h-11 w-full items-center justify-center rounded-[10px] border border-[#f1b4a9] px-base text-[12px] font-extrabold text-[#ad321d] hover:bg-[#fff4f2] disabled:opacity-50">이 회사 이야기 삭제</button> : null}
      </aside>
    </form>
  );
}
