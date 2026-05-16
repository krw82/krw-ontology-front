import Link from "next/link";
import { KrwBrand } from "@/components/KrwBrand";
import {
  HomeHeaderActions,
  HomeQuestionForm,
  HomeTraceExplorer,
  type HomeTraceNode,
} from "@/components/HomeInteractions";
import {
  HeroHeading,
  HeroSubtext,
  HeroEyebrow,
  WorkflowSteps,
  TraceCardEntrance,
  EvidenceCardsStagger,
  EvidenceCardItem,
  InsightBlock,
  QuestionFormEntrance,
} from "@/components/HeroSection";

const evidenceCards = [
  { label: "source", value: "10-K · FY2025", detail: "Item 1 / 사업 개요" },
  { label: "node", value: "AWS", detail: "cloud infrastructure segment" },
  { label: "driver", value: "Margin driver", detail: "capex, utilization, mix" },
];

const traceNodes: HomeTraceNode[] = [
  {
    id: "filing",
    label: "10-K",
    mobileLabel: "10-K",
    eyebrow: "source sentence",
    title: "FY2025 10-K · Item 1",
    detail:
      "AWS revenue is connected to infrastructure scale, usage growth, and operating cost absorption.",
    quote:
      "Cloud demand and infrastructure utilization are tagged as source-backed drivers.",
  },
  {
    id: "segment",
    label: "AWS",
    mobileLabel: "AWS",
    eyebrow: "ontology node",
    title: "Business activity · Cloud Services",
    detail:
      "The segment node keeps product activity, capex pressure, and demand signals in the same trace.",
    quote:
      "AWS maps the filing sentence to the cloud infrastructure activity graph.",
  },
  {
    id: "driver",
    label: "Operating margin",
    mobileLabel: "Margin",
    eyebrow: "answer driver",
    title: "Margin driver · Mix / utilization",
    detail:
      "The final answer is composed from the linked node, not from a detached summary paragraph.",
    quote:
      "Citation labels remain attached to the generated answer for audit review.",
  },
];

const workflowSteps = ["공시 수집", "개념 연결", "근거 답변"];

export default function Home() {
  return (
    <div className="min-h-[100dvh] overflow-x-hidden bg-surface-dark text-on-dark">
      <header className="fixed left-0 right-0 top-0 z-50 border-b border-white/10 bg-surface-dark/85 backdrop-blur-xl">
        <nav className="mx-auto flex h-20 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <KrwBrand dark />

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
                    Live research trace
                  </p>
                  <h2 className="mt-2 text-[24px] font-black leading-[1.08]">
                    AMZN · Cloud margin question
                  </h2>
                </div>
                <span className="w-fit rounded-[6px] bg-surface-dark px-3 py-2 font-mono text-[12px] font-bold text-primary-fixed-dim">
                  3 sources
                </span>
              </div>

              <EvidenceCardsStagger>
                {evidenceCards.map((card) => (
                  <EvidenceCardItem key={card.label}>
                    <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-3 px-1 py-3">
                      <span className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
                        {card.label}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-extrabold text-ink">
                          {card.value}
                        </p>
                        <p className="mt-1 text-[13px] leading-5 text-body">
                          {card.detail}
                        </p>
                      </div>
                    </div>
                  </EvidenceCardItem>
                ))}
              </EvidenceCardsStagger>

              <HomeTraceExplorer nodes={traceNodes} />

              <InsightBlock>
                <p className="text-[15px] font-bold leading-6">
                  답변은 공시 원문과 연결된 사업 활동 노드에서 생성됩니다.
                </p>
                <p className="mt-2 text-[13px] leading-5 text-body">
                  답변 카드마다 출처 라벨, 기간, 공시 섹션이 남아 검증 가능한
                  리서치 기록으로 보관됩니다.
                </p>
              </InsightBlock>
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
