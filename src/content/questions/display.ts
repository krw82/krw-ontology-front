import type { Locale } from "@/i18n/config";
import type {
  QuestionChainNode,
  QuestionTopicPage,
} from "@/lib/marketing/site";

type NodeDisplay = Pick<QuestionChainNode, "title" | "question" | "answerHint">;

interface QuestionDisplayOverride {
  title: string;
  shortTitle: string;
  description: string;
  category: string;
  questionChain: {
    title: string;
    description: string;
    primaryQuestion: string;
    stages: Array<{
      label: string;
      nodes: NodeDisplay[];
    }>;
  };
}

const englishQuestionDisplay: Record<string, QuestionDisplayOverride> = {
  "revenue-growth": {
    title: "Where did revenue growth come from?",
    shortTitle: "Revenue growth",
    description:
      "Separate product, segment, pricing, volume, and regional drivers from 10-K and 10-Q filing evidence.",
    category: "Growth drivers",
    questionChain: {
      title: "Apple revenue question flow",
      description:
        "Start from iPhone and Services, then narrow into Pro models, regional demand, and App Store economics.",
      primaryQuestion:
        "How does Apple make money across iPhone, Services, Mac, iPad, and Wearables, and what drove recent revenue?",
      stages: [
        {
          label: "Business model",
          nodes: [
            {
              title: "How does Apple make money?",
              question:
                "Break down Apple's iPhone, Services, Mac, iPad, and Wearables revenue structure from filings.",
              answerHint: "iPhone · Services · Mac · iPad · Wearables",
            },
          ],
        },
        {
          label: "Revenue mix",
          nodes: [
            {
              title: "What are the iPhone and Services shares?",
              question:
                "Compare how Apple's iPhone and Services revenue mix changed using filing evidence.",
            },
            {
              title: "Are Products and Services growing differently?",
              question:
                "Summarize the growth rate difference between Apple's Products revenue and Services revenue from filings.",
            },
          ],
        },
        {
          label: "Drivers",
          nodes: [
            {
              title: "Is iPhone growth driven by Pro models?",
              question:
                "Connect Apple iPhone revenue changes to Pro models, product cycles, pricing, and volume.",
            },
            {
              title: "Which regions moved demand?",
              question:
                "Show whether revenue changes in Americas, Europe, Greater China, and Rest of Asia Pacific came from iPhone or Services.",
            },
          ],
        },
        {
          label: "Thesis",
          nodes: [
            {
              title: "What does this mean for the growth thesis?",
              question:
                "Separate supporting and cautionary evidence for Apple's growth thesis from iPhone and Services revenue changes.",
            },
          ],
        },
      ],
    },
  },
  "margin-change": {
    title: "Which business factors explain margin change?",
    shortTitle: "Margin change",
    description:
      "Trace gross margin, operating margin, and cost structure changes back to business activity and filing evidence.",
    category: "Profitability",
    questionChain: {
      title: "Apple profitability question flow",
      description:
        "Start with Products versus Services mix, then narrow into supply chain, FX, tariffs, and operating expense effects.",
      primaryQuestion:
        "Explain how Apple's Products and Services revenue mix affected margin changes using filing evidence.",
      stages: [
        {
          label: "Mix",
          nodes: [
            {
              title: "What is the Products and Services mix?",
              question:
                "Summarize how Apple's Products revenue and Services revenue mix changed.",
              answerHint: "Products gross margin · Services gross margin",
            },
          ],
        },
        {
          label: "Margins",
          nodes: [
            {
              title: "Why did gross margin change?",
              question:
                "Connect Apple's gross margin change to product mix, Services share, and cost pressure from filings.",
            },
            {
              title: "What happened to operating margin?",
              question:
                "Explain how Apple's operating margin changed through gross margin, R&D, and SG&A.",
            },
          ],
        },
        {
          label: "Pressure",
          nodes: [
            {
              title: "What about supply chain and tariff pressure?",
              question:
                "Find how Apple's supply chain, component sourcing, tariffs, and raw materials affect pricing and gross margin.",
            },
            {
              title: "How does FX affect margins?",
              question:
                "Summarize how foreign exchange changes affect Apple's revenue, cost of sales, gross margin, and cash flow.",
            },
          ],
        },
        {
          label: "Quality",
          nodes: [
            {
              title: "Is margin improvement structural?",
              question:
                "Separate Services mix improvement from short-term product cycle and cost effects in Apple's margin change.",
            },
          ],
        },
      ],
    },
  },
  "risk-factors": {
    title: "Which business activities connect to core risks?",
    shortTitle: "Risk factors",
    description:
      "Connect Risk Factors language to products, supply chains, regulation, pricing pressure, and external variables.",
    category: "Risk",
    questionChain: {
      title: "Apple risk question flow",
      description:
        "Connect iPhone dependence, App Store regulation, manufacturing concentration, tariffs, and FX to thesis counterpoints.",
      primaryQuestion:
        "Summarize Apple's core business risks from filings and connect them to business activity.",
      stages: [
        {
          label: "Exposure",
          nodes: [
            {
              title: "Where is risk concentrated?",
              question:
                "Identify major risk exposure across Apple's iPhone, Services, and regional revenue structure.",
              answerHint: "iPhone · Services · App Store · supply chain",
            },
          ],
        },
        {
          label: "Risk paths",
          nodes: [
            {
              title: "What is the App Store regulation risk?",
              question:
                "Summarize how Apple describes App Store, external payment, developer fee, and antitrust risks in filings.",
            },
            {
              title: "What is the manufacturing concentration risk?",
              question:
                "Explain how Apple's outsourced manufacturing and supply chain footprint create risk paths.",
            },
          ],
        },
        {
          label: "Business impact",
          nodes: [
            {
              title: "Which regions create the most exposure?",
              question:
                "Connect Apple's regional revenue and supply chain exposure to regulatory, tariff, and demand risks.",
            },
            {
              title: "Where can demand or competition pressure show up?",
              question:
                "Identify how demand slowdown and competition could affect Apple's products, Services, and margins.",
            },
          ],
        },
        {
          label: "Thesis check",
          nodes: [
            {
              title: "Which risks challenge the thesis?",
              question:
                "Separate the Apple risks that most directly weaken a growth or profitability thesis.",
            },
          ],
        },
      ],
    },
  },
  "segment-performance": {
    title: "Which segment moved performance?",
    shortTitle: "Segment performance",
    description:
      "Compare revenue, operating income, and growth across business units to identify company-level drivers.",
    category: "Segments",
    questionChain: {
      title: "Apple segment question flow",
      description:
        "Start with Apple's product and Services structure, then compare contribution, regions, and thesis relevance.",
      primaryQuestion:
        "Identify the Apple segments that moved recent revenue and profit using filing evidence.",
      stages: [
        {
          label: "Structure",
          nodes: [
            {
              title: "Which Apple segments matter most?",
              question:
                "Map Apple's Products, Services, and regional reporting structure from filings.",
              answerHint: "Products · Services · Geography",
            },
          ],
        },
        {
          label: "Contribution",
          nodes: [
            {
              title: "Which product line moved revenue?",
              question:
                "Compare iPhone, Mac, iPad, Wearables, and Services revenue contribution.",
            },
            {
              title: "How different is Services contribution?",
              question:
                "Explain how Services growth and profitability differ from Products.",
            },
          ],
        },
        {
          label: "Drivers",
          nodes: [
            {
              title: "Which regions affected performance?",
              question:
                "Connect regional revenue movement to Apple's key products and Services.",
            },
            {
              title: "Does segment mix improve profit quality?",
              question:
                "Assess whether segment mix changes improve or weaken Apple's profit quality.",
            },
          ],
        },
        {
          label: "Thesis",
          nodes: [
            {
              title: "Which segment matters most to the thesis?",
              question:
                "Identify the segment evidence that most supports or weakens the Apple thesis.",
            },
          ],
        },
      ],
    },
  },
  "capex-and-cash-flow": {
    title: "What signal do capex and cash flow send?",
    shortTitle: "Capex and cash flow",
    description:
      "Read capex, operating cash flow, and free cash flow changes as growth investment or financial burden signals.",
    category: "Cash flow",
    questionChain: {
      title: "Apple investment and cash flow question flow",
      description:
        "Start with investment needs, then narrow into operating cash flow, free cash flow, capacity, and capital return.",
      primaryQuestion:
        "Explain what Apple's capex and cash flow changes signal using filing evidence.",
      stages: [
        {
          label: "Investment base",
          nodes: [
            {
              title: "What is Apple investing in?",
              question:
                "Summarize Apple's capital expenditures, property and equipment, and investment commitments.",
              answerHint: "Capex · PP&E · commitments",
            },
          ],
        },
        {
          label: "Cash flow",
          nodes: [
            {
              title: "How did operating cash flow change?",
              question:
                "Compare Apple's operating cash flow drivers with earnings and working capital changes.",
            },
            {
              title: "What does free cash flow show?",
              question:
                "Explain what Apple's free cash flow says about financial flexibility.",
            },
          ],
        },
        {
          label: "Capacity",
          nodes: [
            {
              title: "Are infrastructure investments increasing?",
              question:
                "Identify whether Apple's filing evidence points to larger data center, manufacturing, or equipment investment.",
            },
            {
              title: "How do buybacks and dividends affect capacity?",
              question:
                "Connect Apple's capital returns to cash flow and balance sheet capacity.",
            },
          ],
        },
        {
          label: "Signal",
          nodes: [
            {
              title: "Is higher capex a growth signal or burden?",
              question:
                "Separate growth investment signals from short-term cash flow burden in Apple's capex changes.",
            },
          ],
        },
      ],
    },
  },
  "thesis-check": {
    title: "Does the investment idea match filing evidence?",
    shortTitle: "Thesis check",
    description:
      "Compare an investment thesis against filing language, performance drivers, risks, and business activity.",
    category: "Validation",
    questionChain: {
      title: "Apple thesis check question flow",
      description:
        "Turn a thesis into testable claims, then separate supporting evidence, counterpoints, and gaps.",
      primaryQuestion:
        "Check whether my Apple thesis matches filing evidence, including support and counter-evidence.",
      stages: [
        {
          label: "Hypothesis",
          nodes: [
            {
              title: "What claims make up the thesis?",
              question:
                "Break an Apple investment thesis into testable revenue, margin, risk, and segment claims.",
              answerHint: "Revenue · Margin · Risk · Segment",
            },
          ],
        },
        {
          label: "Evidence",
          nodes: [
            {
              title: "What filing evidence supports it?",
              question:
                "Find filing evidence that supports the Apple thesis.",
            },
            {
              title: "What evidence weakens it?",
              question:
                "Find filing evidence that challenges or weakens the Apple thesis.",
            },
          ],
        },
        {
          label: "Gaps",
          nodes: [
            {
              title: "Which assumptions are not confirmed?",
              question:
                "Separate Apple thesis assumptions that are not directly confirmed by filings.",
            },
            {
              title: "Which metrics should be checked next?",
              question:
                "Identify the revenue, margin, risk, or cash flow metrics that should be checked next.",
            },
          ],
        },
        {
          label: "Next question",
          nodes: [
            {
              title: "What follow-up question should narrow the thesis?",
              question:
                "Suggest the next specific Apple research question that would narrow the thesis.",
            },
          ],
        },
      ],
    },
  },
};

export function getQuestionTopicDisplay(
  locale: Locale,
  topic: QuestionTopicPage,
): QuestionTopicPage {
  if (locale === "ko") return topic;

  const override = englishQuestionDisplay[topic.slug];
  if (!override) return topic;

  return {
    ...topic,
    title: override.title,
    shortTitle: override.shortTitle,
    description: override.description,
    category: override.category,
    questionChain: {
      ...topic.questionChain,
      title: override.questionChain.title,
      description: override.questionChain.description,
      primaryQuestion: override.questionChain.primaryQuestion,
      stages: topic.questionChain.stages.map((stage, stageIndex) => {
        const displayStage = override.questionChain.stages[stageIndex];

        return {
          ...stage,
          label: displayStage?.label ?? stage.label,
          nodes: stage.nodes.map((node, nodeIndex) => ({
            ...node,
            ...(displayStage?.nodes[nodeIndex] ?? {}),
          })),
        };
      }),
    },
  };
}

export function getQuestionTopicDisplayList(
  locale: Locale,
  topics: QuestionTopicPage[],
): QuestionTopicPage[] {
  return topics.map((topic) => getQuestionTopicDisplay(locale, topic));
}
