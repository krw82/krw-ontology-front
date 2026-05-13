"use client";

import RichAnswerRenderer from "@/components/RichAnswerRenderer";
import type { ResearchArtifact } from "@/types/api-contracts";

interface ResearchArtifactCardProps {
  artifact: ResearchArtifact;
  fallbackMarkdown?: string;
}

export default function ResearchArtifactCard({
  artifact,
  fallbackMarkdown,
}: ResearchArtifactCardProps) {
  return (
    <RichAnswerRenderer
      answer={artifact}
      fallbackMarkdown={fallbackMarkdown}
    />
  );
}
