import type { ShareOgCopy } from "@/lib/share/share-og";

interface ShareOgImageProps {
  copy: ShareOgCopy;
}

export function ShareOgImage({ copy }: ShareOgImageProps) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "#f8fbff",
        color: "#07111f",
        padding: "58px 64px",
        fontFamily:
          "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Apple SD Gothic Neo, Noto Sans KR, sans-serif",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          opacity: 0.62,
          backgroundImage:
            "linear-gradient(#dbe5f2 1px, transparent 1px), linear-gradient(90deg, #dbe5f2 1px, transparent 1px)",
          backgroundSize: "96px 96px",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 12,
          display: "flex",
          background: "#0b4eea",
        }}
      />

      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 32,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 58,
              height: 58,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "2px solid #b9cdf9",
              borderRadius: 14,
              background: "#ffffff",
              color: "#0b4eea",
              fontSize: 34,
              fontWeight: 900,
              lineHeight: 1,
            }}
          >
            K
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 5,
            }}
          >
            <div style={{ display: "flex", fontSize: 26, fontWeight: 900 }}>
              {copy.brandName}
            </div>
            <div
              style={{
                display: "flex",
                color: "#0b4eea",
                fontSize: 17,
                fontWeight: 900,
              }}
            >
              {copy.kicker}
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            border: "2px solid #c9d8f6",
            borderRadius: 999,
            background: "#ffffff",
            color: "#10223a",
            padding: "13px 20px",
            fontSize: 22,
            fontWeight: 900,
            maxWidth: 420,
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
        >
          {copy.tickerLine}
        </div>
      </div>

      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          gap: 26,
          maxWidth: 1040,
        }}
      >
        <div
          style={{
            display: "flex",
            color: "#07111f",
            fontSize: 76,
            fontWeight: 950,
            lineHeight: 1.12,
          }}
        >
          {copy.title}
        </div>
        <div
          style={{
            display: "flex",
            color: "#5d6b7d",
            fontSize: 30,
            fontWeight: 700,
            lineHeight: 1.45,
            maxWidth: 960,
          }}
        >
          {copy.description}
        </div>
      </div>

      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderTop: "2px solid #d8e2f0",
          paddingTop: 28,
        }}
      >
        <div style={{ display: "flex", color: "#5d6b7d", fontSize: 24, fontWeight: 800 }}>
          {copy.footer}
        </div>
        <div style={{ display: "flex", color: "#0b4eea", fontSize: 24, fontWeight: 950 }}>
          krwontology.com
        </div>
      </div>
    </div>
  );
}
