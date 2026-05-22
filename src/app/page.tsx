import Link from "next/link";
import { KrwBrand } from "@/components/KrwBrand";
import {
  HomeHeaderActions,
  HomeEvidenceCards,
  HomeQuestionForm,
  HomeTraceExplorer,
  type HomeEvidenceCard,
  type HomeTraceNode,
} from "@/components/HomeInteractions";
import {
  HeroHeading,
  HeroSubtext,
  HeroEyebrow,
  WorkflowSteps,
  TraceCardEntrance,
  QuestionFormEntrance,
} from "@/components/HeroSection";

const evidenceCards: HomeEvidenceCard[] = [
  {
    id: "source",
    label: "근거",
    value: "회사 보고서",
    detail: "답의 단서가 되는 문장 확인",
  },
  {
    id: "node",
    label: "흐름",
    value: "사업 맥락",
    detail: "실적 변화와 리스크 연결",
  },
  {
    id: "path",
    label: "정리",
    value: "근거 기반 답변",
    detail: "단서를 바탕으로 답변 정리",
  },
];

const traceNodes: HomeTraceNode[] = [
  {
    id: "filing",
    label: "근거",
    mobileLabel: "근거",
    eyebrow: "단서 확인",
    title: "회사 보고서에서 단서 확인",
    detail:
      "질문과 관련된 문장을 먼저 찾아 답변의 출발점을 고정합니다.",
    quote: "답변은 보고서에서 찾은 단서에서 시작됩니다.",
  },
  {
    id: "segment",
    label: "연결",
    mobileLabel: "연결",
    eyebrow: "맥락 연결",
    title: "사업 흐름과 리스크 연결",
    detail:
      "보고서 문장과 관련된 사업 활동, 변수, 기간을 한 화면에서 이어 봅니다.",
    quote: "각 연결은 답변을 만들기 위한 단서로 유지됩니다.",
  },
  {
    id: "driver",
    label: "요약",
    mobileLabel: "요약",
    eyebrow: "답변 준비",
    title: "근거와 함께 핵심 요인 정리",
    detail:
      "연결된 근거를 바탕으로 답변의 주요 요인을 압축합니다.",
    quote: "최종 답변은 연결된 단서를 바탕으로 정리됩니다.",
  },
];

const workflowSteps = ["회사 질문", "단서 찾기", "근거 정리"];

export default function Home() {
  return (
    <div className="min-h-[100dvh] overflow-x-hidden bg-canvas text-ink">
      <header className="fixed left-0 right-0 top-0 z-50 border-b border-hairline bg-canvas/95 backdrop-blur-xl">
        <nav className="mx-auto flex h-20 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <KrwBrand compact />

          <div className="hidden items-center gap-8 text-sm font-semibold text-muted md:flex">
            <Link href="/chat" className="transition-colors hover:text-ink">
              리서치
            </Link>
            <Link
              href="/companies"
              className="transition-colors hover:text-ink"
            >
              회사 목록
            </Link>
          </div>

          <HomeHeaderActions />
        </nav>
      </header>

      <main
        id="main-content"
        className="relative min-h-[100dvh] px-4 pb-16 pt-28 sm:px-6 sm:pb-24 sm:pt-32 lg:px-8"
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(90deg,rgba(10,11,13,0.04)_1px,transparent_1px),linear-gradient(180deg,rgba(10,11,13,0.04)_1px,transparent_1px)] bg-[size:72px_72px]"
        />
        <section className="relative z-10 mx-auto grid w-full max-w-7xl grid-cols-[minmax(0,1fr)] items-start gap-12 lg:min-h-[calc(100dvh-160px)] lg:grid-cols-[minmax(0,0.92fr)_minmax(420px,0.78fr)]">
          <div className="min-w-0 max-w-full">
            <HeroEyebrow>회사 보고서에서 찾은 답의 단서</HeroEyebrow>

            <HeroHeading
              lines={["근거가 보이는"]}
              accentLine="기업 분석 AI"
            />
            <HeroSubtext>
              궁금한 회사를 질문하면, 회사 보고서에서 답의 단서를 찾아
              근거를 바탕으로 정리합니다. 실적 변화, 리스크, 사업 흐름을
              더 쉽게 확인하세요.
            </HeroSubtext>

            <QuestionFormEntrance>
              <HomeQuestionForm />
            </QuestionFormEntrance>

            <WorkflowSteps steps={workflowSteps} />
          </div>

          <TraceCardEntrance>
            <div className="relative max-w-full rounded-[12px] border border-hairline bg-canvas p-4 text-ink shadow-[0_18px_48px_rgba(10,11,13,0.12)] sm:p-5">
              <div className="flex flex-col gap-3 border-b border-hairline pb-4 min-[480px]:flex-row min-[480px]:items-center min-[480px]:justify-between">
                <div className="min-w-0">
                  <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-primary">
                    답변 미리보기
                  </p>
                  <h2 className="mt-2 text-[24px] font-black leading-[1.08]">
                    기업 질문 분석 예시
                  </h2>
                </div>
              </div>

              <HomeEvidenceCards cards={evidenceCards} />

              <HomeTraceExplorer nodes={traceNodes} />
            </div>
          </TraceCardEntrance>
        </section>
      </main>

      <footer className="relative z-10 border-t border-hairline bg-canvas px-4 py-6 text-center text-xs font-bold uppercase leading-5 tracking-[0.14em] text-muted sm:px-6">
        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
          <span>
            © 2026 KRW Ontology Research. 근거 기반 기업 분석.
          </span>
          <span className="hidden h-1 w-1 rounded-full bg-outline-variant sm:block" />
          <Link href="/privacy" className="transition-colors hover:text-ink">
            개인정보처리방침
          </Link>
          <Link href="/terms" className="transition-colors hover:text-ink">
            서비스 약관
          </Link>
        </div>
      </footer>
    </div>
  );
}
