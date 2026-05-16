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
    value: "보고서 문맥",
    detail: "질문과 관련된 문장 확인",
  },
  {
    id: "node",
    label: "연결",
    value: "사업 활동",
    detail: "관련 맥락과 변수 연결",
  },
  {
    id: "path",
    label: "요약",
    value: "핵심 요인",
    detail: "근거 기반 답변 준비",
  },
];

const traceNodes: HomeTraceNode[] = [
  {
    id: "filing",
    label: "근거",
    mobileLabel: "근거",
    eyebrow: "근거 확인",
    title: "보고서 문맥 확인",
    detail:
      "질문과 관련된 문장을 먼저 찾아 답변의 출발점을 고정합니다.",
    quote: "답변은 출처가 남는 문맥에서 시작됩니다.",
  },
  {
    id: "segment",
    label: "연결",
    mobileLabel: "연결",
    eyebrow: "맥락 연결",
    title: "관련 맥락 연결",
    detail:
      "문장과 관련된 사업 활동, 변수, 기간을 한 화면에서 이어 봅니다.",
    quote: "각 연결은 답변을 만들기 위한 검증 가능한 단서로 유지됩니다.",
  },
  {
    id: "driver",
    label: "요약",
    mobileLabel: "요약",
    eyebrow: "답변 준비",
    title: "핵심 요인 정리",
    detail:
      "연결된 근거를 바탕으로 답변의 주요 요인을 압축합니다.",
    quote: "최종 답변에는 검토 가능한 근거 흐름이 남습니다.",
  },
];

const workflowSteps = ["공시 수집", "개념 연결", "근거 답변"];

export default function Home() {
  return (
    <div className="min-h-[100dvh] overflow-x-hidden bg-surface-dark text-on-dark">
      <header className="fixed left-0 right-0 top-0 z-50 border-b border-white/10 bg-surface-dark/85 backdrop-blur-xl">
        <nav className="mx-auto flex h-20 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <KrwBrand dark compact />

          <div className="hidden items-center gap-8 text-sm font-semibold text-on-dark-soft md:flex">
            <Link href="/chat" className="transition-colors hover:text-on-dark">
              리서치
            </Link>
            <Link
              href="/companies"
              className="transition-colors hover:text-on-dark"
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
          className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(180deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:72px_72px]"
        />
        <section className="relative z-10 mx-auto grid w-full max-w-7xl grid-cols-[minmax(0,1fr)] items-start gap-12 lg:min-h-[calc(100dvh-160px)] lg:grid-cols-[minmax(0,0.92fr)_minmax(420px,0.78fr)]">
          <div className="min-w-0 max-w-full">
            <HeroEyebrow>Evidence-first research</HeroEyebrow>

            <HeroHeading
              lines={["기업 질문을"]}
              accentLine="근거 그래프로"
              trailingLines={["답합니다."]}
            />
            <HeroSubtext>
              KRW Ontology는 공시 문장, 사업 활동, 리스크 요인을 연결해
              답변이 어디에서 왔는지 끝까지 추적할 수 있게 합니다.
            </HeroSubtext>

            <QuestionFormEntrance>
              <HomeQuestionForm />
            </QuestionFormEntrance>

            <WorkflowSteps steps={workflowSteps} />
          </div>

          <TraceCardEntrance>
            <div className="relative max-w-full rounded-[12px] border border-white/10 bg-canvas p-4 text-ink shadow-xl shadow-black/25 sm:p-5">
              <div className="flex flex-col gap-3 border-b border-hairline pb-4 min-[480px]:flex-row min-[480px]:items-center min-[480px]:justify-between">
                <div className="min-w-0">
                  <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-primary">
                    Evidence preview
                  </p>
                  <h2 className="mt-2 text-[24px] font-black leading-[1.08]">
                    기업 질문 분석 예시
                  </h2>
                </div>
                <span className="w-fit rounded-[6px] bg-surface-dark px-3 py-2 font-mono text-[12px] font-bold text-primary-fixed-dim">
                  검증 가능
                </span>
              </div>

              <HomeEvidenceCards cards={evidenceCards} />

              <HomeTraceExplorer nodes={traceNodes} />
            </div>
          </TraceCardEntrance>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/10 bg-surface-dark px-4 py-6 text-center text-xs font-bold uppercase leading-5 tracking-[0.14em] text-white/45 sm:px-6">
        © 2026 KRW Ontology Research. Evidence-backed company intelligence.
      </footer>
    </div>
  );
}
