import { describe, expect, it } from "vitest";
import {
  canPollDocumentAttachments,
  getDocumentAttachmentPollDelay,
} from "./attachment-polling";

describe("document attachment polling", () => {
  it("backs off from two to three to five seconds", () => {
    expect([0, 1, 2, 3, 20].map(getDocumentAttachmentPollDelay)).toEqual([
      2_000,
      3_000,
      5_000,
      5_000,
      5_000,
    ]);
  });

  it("pauses while hidden or offline", () => {
    expect(canPollDocumentAttachments("visible", true)).toBe(true);
    expect(canPollDocumentAttachments("hidden", true)).toBe(false);
    expect(canPollDocumentAttachments("visible", false)).toBe(false);
  });
});
