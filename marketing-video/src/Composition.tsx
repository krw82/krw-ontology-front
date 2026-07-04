import type { ReactNode } from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";

export type KrwOntologyAdProps = {
  format: "wide" | "vertical";
};

const TOTAL_FRAMES = 540;

export const VIDEO_DURATION_IN_FRAMES = TOTAL_FRAMES;

const SHOTS = {
  home: "screenshots/krw-home-desktop.png",
  mobile: "screenshots/krw-home-mobile.png",
  chat: "screenshots/krw-components-chat.png",
  companies: "screenshots/krw-components-companies.png",
  landing: "screenshots/krw-components-landing.png",
  notebook: "screenshots/krw-components-notebook.png",
};

const TIMELINE = {
  hook: { from: 0, duration: 108 },
  structure: { from: 108, duration: 132 },
  journeys: { from: 240, duration: 132 },
  output: { from: 372, duration: 108 },
  cta: { from: 480, duration: 60 },
};

type Tone = "blue" | "green" | "amber" | "slate";

const SIGNALS: Array<{
  title: string;
  detail: string;
  tone: Tone;
}> = [
  {
    title: "질문 의도",
    detail: "사업, 실적, 리스크를 한 질문으로 묶습니다.",
    tone: "blue",
  },
  {
    title: "변화 원인",
    detail: "가격 변동 원인을 뉴스와 공시 맥락으로 나눕니다.",
    tone: "amber",
  },
  {
    title: "이벤트 맥락",
    detail: "선택한 기사나 이벤트를 투자 질문으로 바꿉니다.",
    tone: "green",
  },
  {
    title: "후보 비교",
    detail: "테마, 드라이버, 리스크 기준으로 후보를 정리합니다.",
    tone: "blue",
  },
  {
    title: "가정 점검",
    detail: "가정이 흔들리는 조건과 민감도를 확인합니다.",
    tone: "slate",
  },
  {
    title: "노트 정리",
    detail: "최근 대화를 하나의 티커 노트로 정리합니다.",
    tone: "green",
  },
];

const JOURNEYS: Array<{
  question: string;
  focus: string;
  result: string;
  tone: Tone;
}> = [
  {
    question: "오늘 왜 빠졌어?",
    focus: "원인 후보",
    result: "원인 후보를 먼저 분리",
    tone: "amber",
  },
  {
    question: "AI 데이터센터 수혜주 찾아줘",
    focus: "비교 기준",
    result: "테마별 후보와 리스크 정리",
    tone: "blue",
  },
  {
    question: "이 thesis가 깨지는 조건은?",
    focus: "가정 점검",
    result: "민감도와 확인 포인트 도출",
    tone: "slate",
  },
];

const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
const easeInOut = Easing.bezier(0.45, 0, 0.55, 1);

function clampInterpolate(
  frame: number,
  input: [number, number],
  output: [number, number],
  easing = easeOut,
): number {
  return interpolate(frame, input, output, {
    easing,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

function sceneOpacity(frame: number, duration: number, fadeOut = true): number {
  const fadeIn = clampInterpolate(frame, [0, 18], [0, 1]);

  if (!fadeOut) {
    return fadeIn;
  }

  const fadeStart = Math.max(duration - 22, 18);
  const fadeEnd = Math.max(duration, fadeStart + 1);
  const fade = clampInterpolate(frame, [fadeStart, fadeEnd], [1, 0], Easing.in(Easing.cubic));

  return Math.min(fadeIn, fade);
}

function useEntrance(
  delayFrames = 0,
  distance = 28,
): {
  opacity: number;
  y: number;
  scale: number;
} {
  const frame = useCurrentFrame();
  const progress = clampInterpolate(frame, [delayFrames, delayFrames + 24], [0, 1]);

  return {
    opacity: progress,
    y: interpolate(progress, [0, 1], [distance, 0]),
    scale: interpolate(progress, [0, 1], [0.985, 1]),
  };
}

function Kicker({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return <p className={dark ? "kicker kickerDark" : "kicker"}>{children}</p>;
}

function CopyBlock({
  children,
  maxWidth,
  delay = 0,
}: {
  children: ReactNode;
  maxWidth?: number;
  delay?: number;
}) {
  const entrance = useEntrance(delay);

  return (
    <div
      className="copyBlock"
      style={{
        maxWidth,
        opacity: entrance.opacity,
        transform: `translateY(${entrance.y}px) scale(${entrance.scale})`,
      }}
    >
      {children}
    </div>
  );
}

function BrandLockup({ dark = false }: { dark?: boolean }) {
  const entrance = useEntrance(3, 18);

  return (
    <div
      className={dark ? "brandLockup brandLockupDark" : "brandLockup"}
      style={{
        opacity: entrance.opacity,
        transform: `translateY(${entrance.y}px)`,
      }}
    >
      <Img alt="KRW Ontology logo" src={staticFile("krw-logo.svg")} />
      <strong>KRW Ontology</strong>
    </div>
  );
}

function ProductFrame({
  src,
  label,
  delay = 0,
  className = "",
  objectPosition = "50% 0%",
}: {
  src: string;
  label: string;
  delay?: number;
  className?: string;
  objectPosition?: string;
}) {
  const frame = useCurrentFrame();
  const progress = clampInterpolate(frame, [delay, delay + 28], [0, 1]);
  const drift = Math.sin((frame + delay) / 32) * 4;

  return (
    <div
      className={`productFrame ${className}`}
      style={{
        opacity: progress,
        transform: `translateY(${interpolate(progress, [0, 1], [30, drift])}px) scale(${interpolate(
          progress,
          [0, 1],
          [0.97, 1],
        )})`,
      }}
    >
      <div className="browserBar">
        <span />
        <span />
        <span />
        <p>{label}</p>
      </div>
      <Img
        alt={label}
        className="shot"
        src={staticFile(src)}
        style={{ objectPosition }}
      />
    </div>
  );
}

function QuestionCard({
  question,
  delay,
  tone = "blue",
}: {
  question: string;
  delay: number;
  tone?: Tone;
}) {
  const entrance = useEntrance(delay, 22);

  return (
    <div
      className={`questionCard tone_${tone}`}
      style={{
        opacity: entrance.opacity,
        transform: `translateY(${entrance.y}px) scale(${entrance.scale})`,
      }}
    >
      <span>질문</span>
      <strong>{question}</strong>
    </div>
  );
}

function FocusBadge({
  children,
  tone,
  delay,
}: {
  children: ReactNode;
  tone: Tone;
  delay: number;
}) {
  const entrance = useEntrance(delay, 16);

  return (
    <div
      className={`focusBadge tone_${tone}`}
      style={{
        opacity: entrance.opacity,
        transform: `translateY(${entrance.y}px)`,
      }}
    >
      {children}
    </div>
  );
}

function HookScene({ format }: KrwOntologyAdProps) {
  const frame = useCurrentFrame();
  const isVertical = format === "vertical";
  const opacity = sceneOpacity(frame, TIMELINE.hook.duration);
  const arrowProgress = clampInterpolate(frame, [40, 82], [0, 1], easeInOut);

  return (
    <AbsoluteFill className={`scene hookScene ${isVertical ? "vertical" : "wide"}`} style={{ opacity }}>
      <div className="gridBackdrop" />
      <div className="heroDim" />

      <CopyBlock maxWidth={isVertical ? 900 : 850}>
        <BrandLockup />
        <Kicker>Question to research structure</Kicker>
        <h1>
          질문 하나를
          <br />
          리서치 흐름으로
          <span>나눕니다.</span>
        </h1>
        <p className="lead">
          KRW Ontology는 기업 질문을 바로 요약하지 않고, 목적에 맞는 분석 기준으로
          먼저 정리합니다.
        </p>
      </CopyBlock>

      <div className="hookVisual">
        <QuestionCard question="AMZN 클라우드 이익률은 왜 바뀌었나?" delay={12} />
        <div className="routeArrow" style={{ transform: `scaleX(${arrowProgress})` }} />
        <div
          className="structureCore"
          style={{
            opacity: clampInterpolate(frame, [48, 72], [0, 1]),
            transform: `translateY(${clampInterpolate(frame, [48, 72], [18, 0])}px)`,
          }}
        >
          <span>분류</span>
          <strong>질문 의도 분류</strong>
          <p>회사 · 변화 · 리스크 · 다음 질문</p>
        </div>
      </div>

      <div className="hookPreview">
        <ProductFrame
          src={isVertical ? SHOTS.mobile : SHOTS.home}
          label={isVertical ? "Mobile prompt" : "krw-ontology.app"}
          delay={24}
          objectPosition={isVertical ? "50% 0%" : "50% 8%"}
        />
      </div>
    </AbsoluteFill>
  );
}

function SignalCard({
  signal,
  index,
}: {
  signal: (typeof SIGNALS)[number];
  index: number;
}) {
  const frame = useCurrentFrame();
  const delay = 10 + index * 8;
  const entrance = useEntrance(delay, 24);
  const pulse = clampInterpolate(frame, [delay + 18, delay + 34], [0, 1], easeInOut);
  const glow = Math.sin((frame + index * 8) / 18) * 0.5 + 0.5;

  return (
    <div
      className={`signalCard tone_${signal.tone}`}
      style={{
        opacity: entrance.opacity,
        transform: `translateY(${entrance.y}px) scale(${interpolate(pulse, [0, 1], [entrance.scale, 1.015])})`,
        boxShadow: `0 24px 62px rgba(17, 24, 39, ${interpolate(glow, [0, 1], [0.06, 0.12])})`,
      }}
    >
      <div className="signalTopline">
        <span>{String(index + 1).padStart(2, "0")}</span>
        <code>research signal</code>
      </div>
      <strong>{signal.title}</strong>
      <p>{signal.detail}</p>
    </div>
  );
}

function StructureScene({ format }: KrwOntologyAdProps) {
  const frame = useCurrentFrame();
  const isVertical = format === "vertical";
  const opacity = sceneOpacity(frame, TIMELINE.structure.duration);
  const lineProgress = clampInterpolate(frame, [18, 76], [0, 1], easeInOut);

  return (
    <AbsoluteFill className={`scene structureScene ${isVertical ? "vertical" : "wide"}`} style={{ opacity }}>
      <div className="gridBackdrop subtle" />

      <CopyBlock maxWidth={isVertical ? 900 : 670}>
        <Kicker>Research standard</Kicker>
        <h2>
          리서치의 핵심은
          <span>질문 정리입니다.</span>
        </h2>
        <p className="lead">
          질문을 먼저 나누고, 답변에 들어갈 판단 기준을 차례로 세웁니다.
        </p>
      </CopyBlock>

      <div className="structureBoard">
        <div className="structureHub">
          <span>01</span>
          <strong>질문 분해</strong>
          <p>의도와 확인 지점 정리</p>
        </div>
        <div className="structureConnector" style={{ transform: `scaleX(${lineProgress})` }} />
        <div className="signalGrid">
          {SIGNALS.map((signal, index) => (
            <SignalCard key={signal.title} signal={signal} index={index} />
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
}

function JourneyRow({
  journey,
  index,
}: {
  journey: (typeof JOURNEYS)[number];
  index: number;
}) {
  const frame = useCurrentFrame();
  const delay = 8 + index * 22;
  const entrance = useEntrance(delay, 22);
  const lineProgress = clampInterpolate(frame, [delay + 10, delay + 34], [0, 1], easeInOut);

  return (
    <div
      className="journeyRow"
      style={{
        opacity: entrance.opacity,
        transform: `translateY(${entrance.y}px)`,
      }}
    >
      <div className="journeyQuestion">
        <span>Q{index + 1}</span>
        <strong>{journey.question}</strong>
      </div>
      <div className="journeyLine">
        <span style={{ transform: `scaleX(${lineProgress})` }} />
      </div>
      <FocusBadge tone={journey.tone} delay={delay + 12}>
        {journey.focus}
      </FocusBadge>
      <div className="journeyResult">
        <span>결과</span>
        <strong>{journey.result}</strong>
      </div>
    </div>
  );
}

function JourneysScene({ format }: KrwOntologyAdProps) {
  const frame = useCurrentFrame();
  const isVertical = format === "vertical";
  const opacity = sceneOpacity(frame, TIMELINE.journeys.duration);

  return (
    <AbsoluteFill className={`scene journeysScene ${isVertical ? "vertical" : "wide"}`} style={{ opacity }}>
      <div className="gridBackdrop" />

      <CopyBlock maxWidth={isVertical ? 920 : 860}>
        <Kicker>From question to frame</Kicker>
        <h2>
          질문마다 필요한
          <span>확인 기준이 다릅니다.</span>
        </h2>
      </CopyBlock>

      <div className="journeyBoard">
        {JOURNEYS.map((journey, index) => (
          <JourneyRow key={journey.question} journey={journey} index={index} />
        ))}
      </div>

      <div className="journeyPreview">
        <ProductFrame src={SHOTS.chat} label="Question chain" delay={32} objectPosition="50% 52%" />
      </div>
    </AbsoluteFill>
  );
}

function MarkdownLine({
  label,
  body,
  delay,
}: {
  label: string;
  body: string;
  delay: number;
}) {
  const entrance = useEntrance(delay, 18);

  return (
    <div
      className="markdownLine"
      style={{
        opacity: entrance.opacity,
        transform: `translateY(${entrance.y}px)`,
      }}
    >
      <span>{label}</span>
      <p>{body}</p>
    </div>
  );
}

function OutputScene({ format }: KrwOntologyAdProps) {
  const frame = useCurrentFrame();
  const isVertical = format === "vertical";
  const opacity = sceneOpacity(frame, TIMELINE.output.duration);
  const cursor = clampInterpolate(frame, [22, 84], [0, 1], easeInOut);

  return (
    <AbsoluteFill className={`scene outputScene ${isVertical ? "vertical" : "wide"}`} style={{ opacity }}>
      <div className="gridBackdrop subtle" />

      <CopyBlock maxWidth={isVertical ? 900 : 760}>
        <Kicker>Structured research answer</Kicker>
        <h2>
          결과는 문장이 아니라
          <span>점검할 구조입니다.</span>
        </h2>
        <p className="lead">
          핵심 판단, 공시 맥락, 다음 질문을 Markdown 형태로 정리합니다.
        </p>
      </CopyBlock>

      <div className="outputPanel">
        <div className="outputHeader">
          <span>research.md</span>
          <strong>NVDA 매출 성장 점검</strong>
        </div>
        <div className="typingTrack">
          <span style={{ transform: `scaleX(${cursor})` }} />
        </div>
        <MarkdownLine label="판단" body="성장률보다 지속 가능한 수요와 마진 구조를 먼저 확인합니다." delay={18} />
        <MarkdownLine label="맥락" body="사업 부문, 고객 집중도, 설비 투자 흐름을 함께 봅니다." delay={34} />
        <MarkdownLine label="다음 질문" body="이 가정이 깨지는 이벤트를 이어서 점검합니다." delay={50} />
      </div>

      <div className="outputShots">
        <ProductFrame src={SHOTS.companies} label="Research view" delay={20} objectPosition="50% 56%" />
        <ProductFrame
          src={SHOTS.notebook}
          label="Research note"
          delay={34}
          className="outputNote"
          objectPosition="50% 34%"
        />
      </div>
    </AbsoluteFill>
  );
}

function CtaScene({ format }: KrwOntologyAdProps) {
  const frame = useCurrentFrame();
  const isVertical = format === "vertical";
  const opacity = sceneOpacity(frame, TIMELINE.cta.duration, false);
  const buttonProgress = clampInterpolate(frame, [24, 44], [0, 1]);

  return (
    <AbsoluteFill className={`scene ctaScene ${isVertical ? "vertical" : "wide"}`} style={{ opacity }}>
      <div className="gridBackdrop dark" />

      <div className="ctaScreens">
        <ProductFrame src={SHOTS.landing} label="Question chain" delay={2} objectPosition="50% 66%" />
        <ProductFrame
          src={isVertical ? SHOTS.mobile : SHOTS.home}
          label={isVertical ? "Mobile prompt" : "Product home"}
          delay={12}
          className="ctaScreenOffset"
          objectPosition={isVertical ? "50% 0%" : "50% 8%"}
        />
      </div>

      <div className="ctaCopy">
        <BrandLockup dark />
        <CopyBlock maxWidth={isVertical ? 930 : 980} delay={4}>
          <Kicker dark>Filing-aware research structure</Kicker>
          <h2>
            범용 GPT가 아니라,
            <span>기업 질문에 맞춘 답변 구조.</span>
          </h2>
          <p className="lead">
            질문을 먼저 정리하고, 공시 맥락과 확인 포인트를 답변으로 묶습니다.
          </p>
          <div
            className="ctaButton"
            style={{
              opacity: buttonProgress,
              transform: `translateY(${interpolate(buttonProgress, [0, 1], [18, 0])}px)`,
            }}
          >
            <span>무료로 시작</span>
            <strong>→</strong>
          </div>
        </CopyBlock>
      </div>
    </AbsoluteFill>
  );
}

export const KrwOntologyAd = ({ format }: KrwOntologyAdProps) => {
  return (
    <AbsoluteFill className={`adRoot ${format}`}>
      <Sequence
        from={TIMELINE.hook.from}
        durationInFrames={TIMELINE.hook.duration}
        premountFor={30}
      >
        <HookScene format={format} />
      </Sequence>
      <Sequence
        from={TIMELINE.structure.from}
        durationInFrames={TIMELINE.structure.duration}
        premountFor={30}
      >
        <StructureScene format={format} />
      </Sequence>
      <Sequence
        from={TIMELINE.journeys.from}
        durationInFrames={TIMELINE.journeys.duration}
        premountFor={30}
      >
        <JourneysScene format={format} />
      </Sequence>
      <Sequence
        from={TIMELINE.output.from}
        durationInFrames={TIMELINE.output.duration}
        premountFor={30}
      >
        <OutputScene format={format} />
      </Sequence>
      <Sequence
        from={TIMELINE.cta.from}
        durationInFrames={TIMELINE.cta.duration}
        premountFor={30}
      >
        <CtaScene format={format} />
      </Sequence>
    </AbsoluteFill>
  );
};
