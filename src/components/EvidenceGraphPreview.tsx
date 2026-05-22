"use client";

import { useId, useMemo } from "react";
import { motion } from "motion/react";
import type { ToolCallState } from "@/hooks/useChat";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import type {
  ChatCitation,
  ResearchActivityUpdate,
} from "@/types/api-contracts";
import {
  buildEvidenceGraphPreview,
  type EvidenceGraphEdge,
  type EvidenceGraphNode,
} from "@/lib/chat/evidence-graph";

interface EvidenceGraphPreviewProps {
  activity?: ResearchActivityUpdate | null;
  citations?: ChatCitation[];
  toolCalls?: ToolCallState[];
}

interface VisualNodeSlot {
  x: number;
  y: number;
}

const graphTransition = {
  duration: 0.24,
  ease: [0.16, 1, 0.3, 1] as const,
};

function pathForEdge(from: VisualNodeSlot, to: VisualNodeSlot): string {
  const midpointY = (from.y + to.y) / 2;
  const verticalLift = Math.min(9, Math.abs(to.x - from.x) * 0.12);
  const c1y = midpointY - verticalLift;
  const c2y = midpointY + verticalLift;

  return `M ${from.x} ${from.y} C ${from.x} ${c1y}, ${to.x} ${c2y}, ${to.x} ${to.y}`;
}

function svgToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function topicSlots(count: number, compact = false): VisualNodeSlot[] {
  if (count <= 1) return [{ x: 50, y: compact ? 55 : 54 }];
  if (count === 2) {
    return [
      { x: 35, y: compact ? 56 : 55 },
      { x: 65, y: compact ? 56 : 55 },
    ];
  }

  return compact
    ? [
        { x: 20, y: 56 },
        { x: 50, y: 56 },
        { x: 80, y: 56 },
      ]
    : [
        { x: 23, y: 55 },
        { x: 50, y: 55 },
        { x: 77, y: 55 },
      ];
}

function buildNodeSlots(
  nodes: EvidenceGraphNode[],
  compact = false,
): Map<string, VisualNodeSlot> {
  const slots = new Map<string, VisualNodeSlot>();
  const companyNode = nodes.find((node) => node.kind === "company");
  const evidenceNode = nodes.find((node) => node.kind === "evidence");
  const topicNodes = nodes
    .filter((node) => node.kind === "topic" || node.kind === "metric")
    .slice(0, 3);

  if (companyNode) slots.set(companyNode.id, { x: 50, y: compact ? 22 : 20 });
  topicNodes.forEach((node, index) => {
    slots.set(node.id, topicSlots(topicNodes.length, compact)[index]);
  });
  if (evidenceNode) slots.set(evidenceNode.id, { x: 50, y: compact ? 84 : 84 });

  nodes.forEach((node, index) => {
    if (slots.has(node.id)) return;
    slots.set(node.id, { x: 50, y: Math.min(84, 34 + index * 13) });
  });

  return slots;
}

function nodeWidth(node: EvidenceGraphNode, compact = false): number {
  if (node.kind === "company") return compact ? 88 : 112;
  if (node.kind === "evidence") return compact ? 148 : 190;
  if (compact) return 104;
  return node.label.length > 18 ? 168 : 152;
}

function GraphCanvas({
  activeNodeId,
  compact = false,
  edges,
  nodes,
}: {
  activeNodeId: string | null;
  compact?: boolean;
  edges: EvidenceGraphEdge[];
  nodes: EvidenceGraphNode[];
}) {
  const nodeSlots = buildNodeSlots(nodes, compact);
  const reducedMotion = useReducedMotion();
  const canvasId = svgToken(useId());

  return (
    <div
      className={[
        "relative overflow-hidden border-t border-hairline bg-canvas",
        compact ? "h-[172px]" : "h-[236px]",
      ].join(" ")}
      style={{
        backgroundImage:
          "linear-gradient(rgba(8, 11, 15, 0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(8, 11, 15, 0.055) 1px, transparent 1px)",
        backgroundSize: compact ? "28px 28px" : "34px 34px",
      }}
    >
      {!reducedMotion ? (
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0.18, 0.36, 0.22] }}
          transition={{
            duration: 4.8,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          style={{
            background:
              "radial-gradient(circle at 50% 50%, rgba(37, 99, 235, 0.12), transparent 36%)",
          }}
        />
      ) : null}
      <svg
        aria-hidden="true"
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="none"
        viewBox="0 0 100 100"
      >
        <defs>
          <filter
            id={`${canvasId}-edge-glow`}
            x="-30%"
            y="-30%"
            width="160%"
            height="160%"
          >
            <feGaussianBlur stdDeviation="1.8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter
            id={`${canvasId}-particle-glow`}
            x="-80%"
            y="-80%"
            width="260%"
            height="260%"
          >
            <feGaussianBlur stdDeviation="1.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {edges.map((edge, index) => {
          const from = nodeSlots.get(edge.from);
          const to = nodeSlots.get(edge.to);
          if (!from || !to) return null;
          const edgePath = pathForEdge(from, to);
          const isActiveEdge =
            edge.to === activeNodeId || edge.from === activeNodeId;
          const gradientId = `${canvasId}-edge-${index}-${svgToken(edge.id)}`;
          const particleDuration = 2.6 + index * 0.22;

          return (
            <g key={edge.id}>
              <linearGradient
                id={gradientId}
                gradientUnits="userSpaceOnUse"
                x1={from.x}
                x2={to.x}
                y1={from.y}
                y2={to.y}
              >
                <stop offset="0%" stopColor="rgb(191 203 255)" />
                <stop offset="48%" stopColor="rgb(92 124 255)" />
                <stop offset="100%" stopColor="rgb(20 92 255)" />
              </linearGradient>
              <path
                d={edgePath}
                fill="none"
                stroke="rgba(15, 23, 42, 0.12)"
                strokeLinecap="round"
                strokeWidth={compact ? "3.8" : "3.2"}
              />
              <motion.path
                d={edgePath}
                fill="none"
                pathLength={1}
                stroke={`url(#${gradientId})`}
                strokeLinecap="round"
                strokeWidth={
                  isActiveEdge ? (compact ? "2.6" : "2.25") : compact ? "2.2" : "1.9"
                }
                filter={isActiveEdge ? `url(#${canvasId}-edge-glow)` : undefined}
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{
                  pathLength: 1,
                  opacity: isActiveEdge ? 0.92 : 0.62,
                }}
                transition={{
                  duration: reducedMotion ? 0 : 0.82,
                  delay: reducedMotion ? 0 : 0.08 + index * 0.14,
                  ease: [0.16, 1, 0.3, 1],
                }}
              />
              {!reducedMotion ? (
                <circle
                  fill="rgb(37 99 235)"
                  filter={`url(#${canvasId}-particle-glow)`}
                  r={isActiveEdge ? (compact ? 1.08 : 1.18) : compact ? 0.72 : 0.82}
                >
                  <animateMotion
                    begin={`${0.55 + index * 0.18}s`}
                    dur={`${particleDuration}s`}
                    path={edgePath}
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="opacity"
                    dur={`${particleDuration}s`}
                    keyTimes="0;0.12;0.82;1"
                    repeatCount="indefinite"
                    values="0;0.96;0.72;0"
                  />
                </circle>
              ) : null}
            </g>
          );
        })}
      </svg>

      {nodes.map((node, index) => {
        const slot = nodeSlots.get(node.id);
        if (!slot) return null;
        const width = nodeWidth(node, compact);
        const isActive = node.id === activeNodeId;
        const isEvidence = node.kind === "evidence";

        return (
          <div
            key={node.id}
            className="absolute"
            style={{
              left: `${slot.x}%`,
              top: `${slot.y}%`,
              width,
              transform: "translate(-50%, -50%)",
            }}
          >
            <motion.div
              title={node.detail ? `${node.label} · ${node.detail}` : node.label}
              className={[
                "relative flex w-full flex-col items-center justify-center overflow-hidden rounded-full border bg-surface text-center leading-none text-ink shadow-[0_14px_34px_rgba(13,22,40,0.08)]",
                compact
                  ? "min-h-[44px] px-3 py-2"
                  : "min-h-[58px] px-5 py-3",
                isActive
                  ? "border-primary/45 ring-4 ring-primary/10"
                  : "border-hairline",
                isEvidence ? "bg-surface-soft" : "bg-surface",
              ].join(" ")}
              initial={{ opacity: 0, scale: 0.92, y: 4 }}
              animate={
                isActive && !reducedMotion
                  ? { opacity: 1, scale: [1, 1.025, 1], y: 0 }
                  : { opacity: 1, scale: 1, y: 0 }
              }
              transition={{
                duration: reducedMotion ? 0 : 0.28,
                delay: reducedMotion ? 0 : index * 0.16,
                ease: [0.16, 1, 0.3, 1],
                scale: isActive && !reducedMotion
                  ? {
                      duration: 2.4,
                      repeat: Infinity,
                      repeatType: "loop",
                      ease: "easeInOut",
                    }
                  : undefined,
              }}
            >
              {isActive && !reducedMotion ? (
                <>
                  <motion.span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 rounded-full bg-primary/10"
                    animate={{ opacity: [0.1, 0.22, 0.1] }}
                    transition={{
                      duration: 2.4,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }}
                  />
                  <motion.span
                    aria-hidden="true"
                    className="pointer-events-none absolute -left-1/2 top-0 h-full w-1/2 bg-gradient-to-r from-transparent via-primary/15 to-transparent"
                    animate={{ x: ["0%", "320%"] }}
                    transition={{
                      duration: 2.8,
                      repeat: Infinity,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                  />
                </>
              ) : null}
              <span
                className={[
                  "relative z-10 w-full truncate font-black",
                  compact ? "text-[12px]" : "text-[15px]",
                ].join(" ")}
              >
                {node.label}
              </span>
              {node.detail ? (
                <span
                  className={[
                    "relative z-10 mt-1 w-full truncate font-mono font-bold uppercase tracking-[0.08em] text-muted",
                    compact ? "text-[8px]" : "text-[9px]",
                  ].join(" ")}
                >
                  {node.detail}
                </span>
              ) : null}
            </motion.div>
          </div>
        );
      })}
    </div>
  );
}

export default function EvidenceGraphPreview({
  activity,
  citations = [],
  toolCalls = [],
}: EvidenceGraphPreviewProps) {
  const model = useMemo(
    () => buildEvidenceGraphPreview(toolCalls, citations, activity),
    [activity, citations, toolCalls],
  );
  const nodes = model.nodes.slice(0, 5);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = model.edges.filter(
    (edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to),
  );
  const shouldRender =
    nodes.length > 0 && (toolCalls.length > 0 || citations.length > 0);

  if (!shouldRender) return null;

  return (
    <motion.div
      className="mb-md w-full max-w-[780px] overflow-hidden rounded-[8px] border border-hairline bg-surface shadow-sm"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={graphTransition}
      aria-label={model.title}
    >
      <div className="bg-surface px-base py-sm">
        <div className="flex items-center justify-between gap-sm">
          <p className="min-w-0 truncate font-mono text-[12px] font-black uppercase leading-5 tracking-[0.18em] text-primary">
            근거 경로 생성 중
          </p>
          <span className="min-w-0 truncate text-right text-[12px] font-bold leading-4 text-muted">
            {model.title}
          </span>
        </div>
      </div>

      <div className="sm:hidden">
        <GraphCanvas
          activeNodeId={model.activeNodeId}
          compact
          edges={edges}
          nodes={nodes}
        />
      </div>
      <div className="hidden sm:block">
        <GraphCanvas
          activeNodeId={model.activeNodeId}
          edges={edges}
          nodes={nodes}
        />
      </div>
    </motion.div>
  );
}
