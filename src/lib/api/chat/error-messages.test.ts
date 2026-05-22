import { describe, expect, it } from "vitest";
import { publicErrorMessage } from "./error-messages";

describe("publicErrorMessage", () => {
  it("maps known operational errors to Korean user-facing copy", () => {
    expect(publicErrorMessage("concurrency_limit")).toBe(
      "현재 요청이 많습니다. 잠시 후 다시 시도해주세요.",
    );
    expect(publicErrorMessage("lease_expired")).toBe(
      "분석 시간이 초과되었습니다. 다시 시도해주세요.",
    );
  });

  it("does not echo unknown internal error codes", () => {
    expect(publicErrorMessage("stack trace: secret=abc")).toBe(
      "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.",
    );
  });
});
