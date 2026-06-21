import type { ShareOgCopy } from "@/lib/share/share-og";

interface ShareOgImageProps {
  copy: ShareOgCopy;
}

export function ShareOgImage({ copy }: ShareOgImageProps) {
  const isEnglish = copy.kicker.toUpperCase().includes("SHARED");
  const questionLabel = isEnglish ? "01  QUESTION" : "01  질문";
  const answerLabel = isEnglish ? "02  ANSWER" : "02  답변";
  const questionText = copy.description;
  const answerText = copy.title;
  const tickerLine = copy.tickerLine;

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
          height: 84,
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "2px solid #e2e7f0",
          padding: "0 58px",
          background: "#ffffff",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 52,
              height: 52,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "2px solid #b9cdf9",
              borderRadius: 13,
              background: "#ffffff",
              color: "#0b4eea",
              fontSize: 34,
              fontWeight: 950,
              lineHeight: 1,
            }}
          >
            K
          </div>
          <div style={{ display: "flex", fontSize: 30, fontWeight: 950 }}>
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
            maxWidth: 360,
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
          display: "flex",
          flexDirection: "column",
          flex: 1,
          gap: 24,
          padding: "36px 58px 24px",
          background: "#ffffff",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 28,
          }}
        >
          <div
            style={{
              width: 128,
              flexShrink: 0,
              display: "flex",
              color: "#0b4eea",
              fontSize: 19,
              fontWeight: 950,
              letterSpacing: 4,
              lineHeight: 1.2,
            }}
          >
            {questionLabel}
          </div>
          <div
            style={{
              minWidth: 0,
              flex: 1,
              display: "flex",
              borderLeft: "5px solid #0b4eea",
              paddingLeft: 28,
              color: "#07111f",
              fontSize: 36,
              fontWeight: 900,
              lineHeight: 1.28,
            }}
          >
            {questionText}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 28,
          }}
        >
          <div
            style={{
              width: 128,
              flexShrink: 0,
              display: "flex",
              color: "#0b4eea",
              fontSize: 19,
              fontWeight: 950,
              letterSpacing: 4,
              lineHeight: 1.2,
            }}
          >
            {answerLabel}
          </div>
          <div
            style={{
              minWidth: 0,
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: 18,
              border: "2px solid #d8dee8",
              borderRadius: 22,
              background: "#ffffff",
              padding: "24px 30px 26px",
              boxShadow: "0 16px 42px rgba(15, 23, 42, 0.08)",
            }}
          >
            <div
              style={{
                display: "flex",
                color: "#07111f",
                fontSize: 46,
                fontWeight: 950,
                lineHeight: 1.12,
                maxWidth: 900,
              }}
            >
              {answerText}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
              }}
            >
              <div
                style={{
                  display: "flex",
                  color: "#0b4eea",
                  fontSize: 18,
                  fontWeight: 950,
                  letterSpacing: 4,
                }}
              >
                KRW RESEARCH
              </div>
              <div
                style={{
                  display: "flex",
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: "#c9d0da",
                }}
              />
              <div
                style={{
                  display: "flex",
                  minWidth: 0,
                  maxWidth: 560,
                  color: "#6c7685",
                  fontSize: 22,
                  fontWeight: 850,
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis",
                }}
              >
                {tickerLine}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 22,
          height: 76,
          padding: "0 58px 22px",
          background: "#ffffff",
        }}
      >
        <div
          style={{
            height: 54,
            flex: 1,
            display: "flex",
            alignItems: "center",
            border: "2px solid #d8dee8",
            borderRadius: 28,
            background: "#ffffff",
            color: "#7a8492",
            padding: "0 26px",
            fontSize: 21,
            fontWeight: 850,
          }}
        >
          {copy.footer}
        </div>
        <div
          style={{
            width: 54,
            height: 54,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 999,
            background: "#dfe2ee",
            color: "#7a8492",
            fontSize: 34,
            fontWeight: 900,
          }}
        >
          ↑
        </div>
      </div>
    </div>
  );
}
