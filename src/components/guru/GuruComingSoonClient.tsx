"use client";

interface GuruComingSoonClientProps {
  locale: string;
}

export default function GuruComingSoonClient({
  locale,
}: GuruComingSoonClientProps) {
  const isKo = locale === "ko";

  return (
    <main
      id="main-content"
      className="px-base pb-[112px] pt-lg sm:px-md md:px-xl md:pb-[96px] md:pt-xl"
    >
      <div className="mx-auto w-full max-w-[920px]">
        <section className="border-b border-hairline pb-6">
          <p className="font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-primary">
            Guru office
          </p>
          <h1 className="mt-2 text-balance text-[34px] font-black leading-[1.08] tracking-normal text-ink sm:text-[48px]">
            {isKo ? "구루 상담소" : "Guru office"}
          </h1>
          <div className="mt-4 inline-flex h-8 items-center rounded-[8px] border border-hairline bg-surface px-3 font-mono text-[11px] font-black uppercase tracking-[0.12em] text-primary">
            {isKo ? "출시 예정" : "Coming soon"}
          </div>
        </section>

        <section className="mt-6 grid gap-4 md:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-w-0">
            <h2 className="text-[22px] font-black leading-8 text-ink">
              {isKo
                ? "투자 구루의 시선으로 질문하는 공간을 준비 중입니다."
                : "A guided space for asking through investor perspectives is in progress."}
            </h2>
            <p className="mt-3 max-w-2xl text-[15px] font-semibold leading-7 text-body">
              {isKo
                ? "워런 버핏, 하워드 막스, 빌 애크먼 같은 투자자의 사고 프레임을 선택하고, 그 관점으로 기업과 투자 질문을 점검하는 흐름으로 준비하고 있습니다."
                : "This will let you choose an investor frame, then examine companies and investment questions through that perspective."}
            </p>
          </div>

          <div className="rounded-[8px] border border-hairline bg-surface-soft p-4">
            <p className="font-mono text-[11px] font-black uppercase tracking-[0.12em] text-muted">
              {isKo ? "준비 중인 흐름" : "Planned flow"}
            </p>
            <ul className="mt-3 space-y-2 text-[13px] font-bold leading-6 text-body">
              <li>{isKo ? "구루 선택" : "Choose a guru"}</li>
              <li>{isKo ? "관점 확인" : "Review the lens"}</li>
              <li>{isKo ? "채팅 상담 시작" : "Start guided chat"}</li>
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}
