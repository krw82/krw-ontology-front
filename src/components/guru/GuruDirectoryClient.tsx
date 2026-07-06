"use client";

import Link from "next/link";
import {
  buildGuruLensHref,
  GURU_DIRECTORY_LENSES,
  getGuruLensDisplayName,
  type GuruLensOption,
} from "@/lib/guru-lenses";

interface GuruDirectoryClientProps {
  locale: string;
}

export default function GuruDirectoryClient({
  locale,
}: GuruDirectoryClientProps) {
  const isKo = locale === "ko";

  return (
    <main
      id="main-content"
      className="px-base pb-[112px] pt-lg sm:px-md md:px-xl md:pb-[96px] md:pt-xl"
    >
      <div className="mx-auto w-full max-w-[1240px]">
        <header className="border-b border-hairline pb-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-primary">
                Guru ontology
              </p>
              <h1 className="mt-2 text-balance text-[30px] font-black leading-[1.08] tracking-normal text-ink sm:text-[40px]">
                {isKo ? "구루 목록" : "Guru directory"}
              </h1>
              <p className="mt-3 max-w-3xl text-[15px] leading-6 text-body sm:text-[16px]">
                {isKo
                  ? "투자자 렌즈를 먼저 고른 뒤, 해당 구루 온톨로지의 원칙과 질문 프레임으로 채팅을 시작합니다."
                  : "Choose an investor lens first, then start chat with that guru ontology's principles and question frames."}
              </p>
            </div>
          </div>
        </header>

        <section className="mt-5">
          <div className="mb-3 flex items-end justify-between gap-3">
            <h2 className="text-[19px] font-black leading-7 text-ink">
              {isKo ? "구루 선택" : "Choose a guru"}
            </h2>
            <p className="font-mono text-[11px] font-bold leading-4 text-muted">
              {GURU_DIRECTORY_LENSES.length.toLocaleString()} LENSES
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {GURU_DIRECTORY_LENSES.map((lens) => (
              <GuruCard key={lens.key} lens={lens} locale={locale} />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function GuruCard({
  lens,
  locale,
}: {
  lens: GuruLensOption;
  locale: string;
}) {
  const isKo = locale === "ko";
  const affiliation = isKo ? lens.affiliationKo : lens.affiliationEn;
  const intro = isKo ? lens.introKo : lens.introEn;
  const perspective = isKo ? lens.perspectiveKo : lens.perspectiveEn;
  const displayName = getGuruLensDisplayName(lens, locale);

  return (
    <Link
      href={buildGuruLensHref(lens.key, locale)}
      className="group flex min-h-[260px] min-w-0 flex-col rounded-[8px] border border-hairline bg-canvas p-4 text-left text-ink transition-[background-color,border-color,color,transform] hover:border-outline hover:bg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-fixed-dim/35"
      aria-label={`${displayName} ${isKo ? "채팅 열기" : "chat"}`}
    >
      <div className="min-w-0">
        <span className="block min-w-0 text-[17px] font-black leading-6 text-ink">
          {displayName}
        </span>
        <span className="mt-1 block min-w-0 truncate font-mono text-[10px] font-black uppercase leading-4 tracking-[0.12em] text-primary">
          {affiliation}
        </span>
      </div>

      <p className="mt-4 line-clamp-3 min-w-0 text-[13px] font-bold leading-5 text-body">
        {intro}
      </p>

      <div className="mt-4 border-t border-hairline pt-3">
        <p className="font-mono text-[10px] font-black uppercase leading-4 tracking-[0.12em] text-muted">
          {isKo ? "시선" : "Lens"}
        </p>
        <p className="mt-1 line-clamp-3 min-w-0 text-[12px] font-semibold leading-5 text-body">
          {perspective}
        </p>
      </div>

      <span className="mt-auto flex items-center justify-between pt-3 text-[11px] font-black leading-4 text-muted">
        <span>{isKo ? "채팅 시작" : "Start chat"}</span>
        <span
          aria-hidden="true"
          className="material-symbols-outlined text-[18px] transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
        >
          arrow_forward
        </span>
      </span>
    </Link>
  );
}
