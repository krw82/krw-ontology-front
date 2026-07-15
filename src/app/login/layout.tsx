import type { Metadata } from "next";
import { pageMetadata } from "@/lib/marketing/site";

export const metadata: Metadata = pageMetadata({
  title: "로그인",
  description: "Google 또는 이메일로 KRW.O 리서치를 시작합니다.",
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
