"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type EditorialFormat = "single_image" | "carousel" | "text";
type EditorialStatus = "draft" | "published";

const MAX_ASSETS = 8;

export default function EditorialCreateForm() {
  const router = useRouter();
  const [format, setFormat] = useState<EditorialFormat>("carousel");
  const [status, setStatus] = useState<EditorialStatus>("draft");
  const [files, setFiles] = useState<File[]>([]);
  const [altTexts, setAltTexts] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [ticker, setTicker] = useState("");
  const [publishAt, setPublishAt] = useState("");
  const [actionLabel, setActionLabel] = useState("");
  const [actionHref, setActionHref] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previews = useMemo(() => files.map((file) => ({ file, url: URL.createObjectURL(file) })), [files]);

  useEffect(() => () => {
    previews.forEach((preview) => URL.revokeObjectURL(preview.url));
  }, [previews]);

  function replaceFiles(next: File[]) {
    const limited = next.slice(0, MAX_ASSETS);
    setFiles(format === "single_image" ? limited.slice(0, 1) : limited);
    setAltTexts((current) => limited.map((_, index) => current[index] ?? ""));
  }

  function addFiles(nextFiles: FileList | File[]) {
    replaceFiles([...files, ...Array.from(nextFiles)]);
  }

  function moveFile(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= files.length) return;
    const ordered = [...files];
    [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
    replaceFiles(ordered);
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
    files.forEach((file, index) => {
      formData.append("files", file);
      formData.set(`alt_${index}`, altTexts[index] ?? "");
    });
    setPending(true);
    try {
      const response = await fetch("/api/editorial", { method: "POST", body: formData });
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

  return (
    <form onSubmit={submit} className="grid gap-xl lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="space-y-lg rounded-[18px] border border-hairline bg-white p-lg shadow-[0_12px_36px_rgba(16,24,40,0.055)] sm:p-xl">
        <label className="block">
          <span className="text-[12px] font-black text-ink">제목</span>
          <input required value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} placeholder="예: 아이폰 판매량보다 서비스가 중요한 이유" className="mt-xs min-h-12 w-full rounded-[10px] border border-hairline px-sm text-[15px] font-bold outline-none focus:border-primary" />
        </label>
        <label className="block">
          <span className="text-[12px] font-black text-ink">요약</span>
          <textarea value={body} onChange={(event) => setBody(event.target.value)} maxLength={2000} rows={4} placeholder="Pulse 카드에서 이미지 아래에 보여줄 한두 문장을 작성하세요." className="mt-xs w-full rounded-[10px] border border-hairline px-sm py-sm text-[14px] leading-6 outline-none focus:border-primary" />
        </label>
        <div className="grid gap-base sm:grid-cols-2">
          <label className="block">
            <span className="text-[12px] font-black text-ink">콘텐츠 형식</span>
            <select value={format} onChange={(event) => { const next = event.target.value as EditorialFormat; setFormat(next); if (next === "text") replaceFiles([]); }} className="mt-xs min-h-12 w-full rounded-[10px] border border-hairline bg-white px-sm text-[14px] font-bold outline-none focus:border-primary">
              <option value="single_image">단일 이미지</option>
              <option value="carousel">이미지 캐러셀</option>
              <option value="text">텍스트</option>
            </select>
          </label>
          <label className="block">
            <span className="text-[12px] font-black text-ink">연결 종목 (선택)</span>
            <input value={ticker} onChange={(event) => setTicker(event.target.value.toUpperCase())} maxLength={12} placeholder="AAPL" className="mt-xs min-h-12 w-full rounded-[10px] border border-hairline px-sm text-[14px] font-bold uppercase outline-none focus:border-primary" />
          </label>
        </div>
        {format !== "text" ? <section>
          <div className="flex items-end justify-between gap-sm">
            <div><p className="text-[12px] font-black text-ink">이미지</p><p className="mt-0.5 text-[12px] text-muted">JPG, PNG, WebP · 장당 8MB · 최대 {MAX_ASSETS}장</p></div>
            <label className="inline-flex min-h-10 cursor-pointer items-center rounded-[9px] bg-ink px-sm text-[12px] font-extrabold text-white hover:bg-primary">이미지 추가<input type="file" accept="image/jpeg,image/png,image/webp" multiple={format === "carousel"} className="sr-only" onChange={(event) => event.currentTarget.files && addFiles(event.currentTarget.files)} /></label>
          </div>
          <div onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files); }} className="mt-sm rounded-[12px] border border-dashed border-[#b9c4d7] bg-surface-soft p-sm">
            {previews.length === 0 ? <p className="grid min-h-32 place-items-center text-center text-[13px] font-semibold text-muted">이미지를 이곳으로 끌어오거나 ‘이미지 추가’를 선택하세요.</p> : <div className="grid gap-sm sm:grid-cols-2">{previews.map(({ file, url }, index) => <div key={`${file.name}-${index}`} className="overflow-hidden rounded-[10px] border border-hairline bg-white"><img src={url} alt="업로드 미리보기" className="aspect-square w-full object-cover" /><div className="space-y-xs p-sm"><div className="flex items-center justify-between gap-xs"><span className="truncate text-[12px] font-bold text-ink">{index + 1}. {file.name}</span><button type="button" onClick={() => replaceFiles(files.filter((_, fileIndex) => fileIndex !== index))} className="text-[12px] font-bold text-[#c43c22]">삭제</button></div><input value={altTexts[index] ?? ""} onChange={(event) => setAltTexts((current) => current.map((value, valueIndex) => valueIndex === index ? event.target.value : value))} maxLength={240} placeholder="이미지 설명" className="min-h-10 w-full rounded-[8px] border border-hairline px-xs text-[12px] outline-none focus:border-primary" />{format === "carousel" ? <div className="flex gap-xs"><button type="button" onClick={() => moveFile(index, -1)} disabled={index === 0} className="text-[12px] font-bold text-primary disabled:text-muted">앞으로</button><button type="button" onClick={() => moveFile(index, 1)} disabled={index === files.length - 1} className="text-[12px] font-bold text-primary disabled:text-muted">뒤로</button></div> : null}</div></div>)}</div>}
          </div>
        </section> : null}
        <div className="grid gap-base sm:grid-cols-2">
          <label className="block"><span className="text-[12px] font-black text-ink">버튼 문구 (선택)</span><input value={actionLabel} onChange={(event) => setActionLabel(event.target.value)} maxLength={80} placeholder="예: Apple 리서치 보기" className="mt-xs min-h-12 w-full rounded-[10px] border border-hairline px-sm text-[14px] outline-none focus:border-primary" /></label>
          <label className="block"><span className="text-[12px] font-black text-ink">버튼 링크 (선택)</span><input value={actionHref} onChange={(event) => setActionHref(event.target.value)} maxLength={2000} placeholder="/watchlist/AAPL" className="mt-xs min-h-12 w-full rounded-[10px] border border-hairline px-sm text-[14px] outline-none focus:border-primary" /></label>
        </div>
      </section>
      <aside className="h-fit space-y-base rounded-[18px] border border-hairline bg-white p-lg shadow-[0_12px_36px_rgba(16,24,40,0.055)]">
        <div><p className="text-[12px] font-black text-ink">발행 상태</p><div className="mt-xs grid grid-cols-2 rounded-[10px] bg-surface-soft p-1"><button type="button" onClick={() => setStatus("draft")} className={`min-h-10 rounded-[8px] text-[12px] font-extrabold ${status === "draft" ? "bg-white text-ink shadow-sm" : "text-muted"}`}>초안</button><button type="button" onClick={() => setStatus("published")} className={`min-h-10 rounded-[8px] text-[12px] font-extrabold ${status === "published" ? "bg-white text-ink shadow-sm" : "text-muted"}`}>발행</button></div></div>
        <label className="block"><span className="text-[12px] font-black text-ink">발행 일시{status === "published" ? "" : " (선택)"}</span><input required={status === "published"} type="datetime-local" value={publishAt} onChange={(event) => setPublishAt(event.target.value)} className="mt-xs min-h-12 w-full rounded-[10px] border border-hairline px-sm text-[13px] outline-none focus:border-primary" /></label>
        <div className="rounded-[10px] bg-[#f3fbf8] p-sm text-[12px] leading-5 text-body"><strong className="font-extrabold text-ink">Pulse 노출 규칙</strong><br />발행 상태이고 발행 시간이 지난 콘텐츠만 피드 후보가 됩니다. 이미지가 있는 콘텐츠는 기존 4컷 카드가 아니라 이미지 카드로 표시됩니다.</div>
        {error ? <p role="alert" className="rounded-[10px] bg-[#fff1ed] p-sm text-[12px] font-semibold text-[#a33520]">{error}</p> : null}
        <button disabled={pending} className="inline-flex min-h-12 w-full items-center justify-center rounded-[10px] bg-ink px-base text-[13px] font-extrabold text-white hover:bg-primary disabled:opacity-50">{pending ? "저장 중…" : status === "published" ? "발행하기" : "초안 저장"}</button>
      </aside>
    </form>
  );
}
