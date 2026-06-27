import { describe, expect, it } from "vitest";
import { extractFollowUpQuestions } from "./follow-up-questions";

describe("extractFollowUpQuestions", () => {
  it("extracts a terminal Korean follow-up section and removes it from body", () => {
    const result = extractFollowUpQuestions(
      [
        "본문입니다.",
        "",
        "### 이어서 볼 질문",
        "",
        "- 지금 가격에서 신규 진입 조건만 정리해줘.",
        "- 판단이 깨지는 리스크 신호만 뽑아줘.",
        "- 상승·하락·횡보 시나리오별 체크포인트를 나눠줘.",
      ].join("\n"),
    );

    expect(result).toEqual({
      body: "본문입니다.",
      questions: [
        "지금 가격에서 신규 진입 조건만 정리해줘.",
        "판단이 깨지는 리스크 신호만 뽑아줘.",
        "상승·하락·횡보 시나리오별 체크포인트를 나눠줘.",
      ],
    });
  });

  it("supports legacy bare follow-up question lines", () => {
    const result = extractFollowUpQuestions(
      [
        "본문입니다.",
        "",
        "다음으로 파고들 질문",
        "",
        "마진 개선이 유지되는 조건은 무엇인가요?",
        "반대로 봐야 할 리스크만 정리해줘.",
      ].join("\n"),
    );

    expect(result?.questions).toEqual([
      "마진 개선이 유지되는 조건은 무엇인가요?",
      "반대로 봐야 할 리스크만 정리해줘.",
    ]);
  });

  it("falls back when the section is ambiguous or partial", () => {
    expect(
      extractFollowUpQuestions(
        ["본문입니다.", "", "### 이어서 볼 질문", "", "- 하나만 정리해줘."].join(
          "\n",
        ),
      ),
    ).toBeNull();

    expect(
      extractFollowUpQuestions(
        [
          "본문입니다.",
          "",
          "### 이어서 볼 질문",
          "",
          "- query_context로 리스크를 확인해줘.",
          "- 다음 질문을 정리해줘.",
        ].join("\n"),
      ),
    ).toBeNull();

    expect(
      extractFollowUpQuestions(
        [
          "본문입니다.",
          "",
          "### 이어서 볼 질문",
          "",
          "- 조건을 정리해줘.",
          "",
          "추가 문장입니다.",
        ].join("\n"),
      ),
    ).toBeNull();
  });
});
