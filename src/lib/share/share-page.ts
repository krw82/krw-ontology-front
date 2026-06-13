import type { Locale } from "@/i18n/config";
import { findPublicMessageShare } from "@/lib/share/message-share";

const tokenPattern = /^[A-Za-z0-9_-]{16,80}$/;

export async function getPublicShareForPage(token: string) {
  if (!tokenPattern.test(token)) return null;
  return findPublicMessageShare(token);
}

export function sharePageMetadataCopy(locale: Locale) {
  return locale === "en"
    ? {
        notFoundTitle: "Shared answer not found | KRW Ontology",
        description: "A shared research answer from KRW Ontology.",
      }
    : {
        notFoundTitle: "공유 답변을 찾지 못했습니다 | KRW Ontology",
        description: "KRW Ontology에서 공유된 리서치 답변입니다.",
      };
}
