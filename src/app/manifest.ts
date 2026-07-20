import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "KRW.O",
    short_name: "KRW.O",
    description: "KRW.O가 제공하는 근거 기반 기업 리서치와 데이터 분석.",
    start_url: "/app?source=pwa",
    scope: "/",
    display: "standalone",
    lang: "ko-KR",
    categories: ["finance", "business", "productivity"],
    background_color: "#ffffff",
    theme_color: "#003ec7",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "오늘의 피드",
        short_name: "피드",
        url: "/pulse?source=pwa_shortcut",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "새 리서치",
        short_name: "리서치",
        url: "/chat/new?source=pwa_shortcut",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "리서치 노트북",
        short_name: "노트",
        url: "/watchlist?source=pwa_shortcut",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "새 공시",
        short_name: "공시",
        url: "/filings?source=pwa_shortcut",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
