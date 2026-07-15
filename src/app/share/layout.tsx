import type { Metadata } from "next";
import { pageMetadata } from "@/lib/marketing/site";

export const metadata: Metadata = pageMetadata({
  title: "공유 답변",
  description: "KRW.O에서 공유된 답변입니다.",
  path: "/share",
  noIndex: true,
});

export default function ShareLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
