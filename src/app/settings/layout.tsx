import type { Metadata } from "next";
import { pageMetadata } from "@/lib/marketing/site";

export const metadata: Metadata = pageMetadata({
  title: "설정",
  description: "KRW Ontology 계정 설정 화면입니다.",
  path: "/settings",
  noIndex: true,
});

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
