import type { Metadata } from "next";
import { pageMetadata } from "@/lib/marketing/site";

export const metadata: Metadata = pageMetadata({
  title: "무료 베타 로그인",
  description: "Google 계정으로 KRW Ontology 무료 베타를 시작합니다.",
  path: "/login",
  noIndex: true,
});

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
