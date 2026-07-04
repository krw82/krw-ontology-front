import type { PageOgCopy } from "@/lib/og/page-og";

interface PageOgImageProps {
  copy: PageOgCopy;
}

export function PageOgImage({ copy }: PageOgImageProps) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#ffffff",
        color: "#07111f",
        fontFamily:
          "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, Noto Sans KR, sans-serif",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: 92,
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 58px",
          borderBottom: "2px solid #e2e7f0",
          background: "#ffffff",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 54,
              height: 54,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "2px solid #b9cdf9",
              borderRadius: 14,
              background: "#ffffff",
              color: "#0b4eea",
              fontSize: 35,
              fontWeight: 950,
              lineHeight: 1,
            }}
          >
            K
          </div>
          <div style={{ display: "flex", fontSize: 31, fontWeight: 950 }}>
            {copy.brandName}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            border: "2px solid #d7e0f3",
            borderRadius: 14,
            background: "#f6f8fb",
            color: "#0b4eea",
            padding: "11px 18px",
            fontSize: 18,
            fontWeight: 950,
            maxWidth: 390,
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
        >
          {copy.kicker}
        </div>
      </div>

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "46px 58px 38px",
          background: "#ffffff",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 24,
            maxWidth: 1000,
          }}
        >
          <div
            style={{
              display: "flex",
              color: "#0b4eea",
              fontSize: 21,
              fontWeight: 950,
              letterSpacing: 4,
              lineHeight: 1.2,
            }}
          >
            {copy.badge.toUpperCase()}
          </div>
          <div
            style={{
              display: "flex",
              color: "#07111f",
              fontSize: 64,
              fontWeight: 950,
              lineHeight: 1.08,
              maxWidth: 1040,
            }}
          >
            {copy.title}
          </div>
          <div
            style={{
              display: "flex",
              color: "#5c6877",
              fontSize: 30,
              fontWeight: 780,
              lineHeight: 1.35,
              maxWidth: 980,
            }}
          >
            {copy.description}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            height: 70,
            borderTop: "2px solid #e2e7f0",
            paddingTop: 26,
          }}
        >
          <div
            style={{
              width: 12,
              height: 12,
              display: "flex",
              borderRadius: 999,
              background: "#0b4eea",
            }}
          />
          <div
            style={{
              display: "flex",
              color: "#6c7685",
              fontSize: 24,
              fontWeight: 820,
              lineHeight: 1.25,
              maxWidth: 980,
            }}
          >
            {copy.footer}
          </div>
        </div>
      </div>
    </div>
  );
}
