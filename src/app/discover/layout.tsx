import type { Metadata } from "next";
import { pageMetadata } from "@/lib/marketing/site";

export const metadata: Metadata = pageMetadata({
  title: "리서치 채팅",
  description: "로그인 후 개인 리서치 채팅을 이어서 확인합니다.",
  path: "/discover",
  noIndex: true,
});

export default function DiscoverLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
