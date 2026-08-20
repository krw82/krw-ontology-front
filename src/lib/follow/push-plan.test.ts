import { describe, expect, it } from "vitest";
import { planPushEnable } from "./use-company-follow";

const base = {
  pushReady: false,
  webPushSupported: true,
  vapidKey: "key",
  permission: "default" as NotificationPermission,
  iOS: false,
  standalone: false,
};

describe("planPushEnable", () => {
  it("already on when the device subscription exists", () => {
    expect(planPushEnable({ ...base, pushReady: true })).toBe("already");
  });

  it("install on iOS without standalone display", () => {
    expect(planPushEnable({ ...base, iOS: true })).toBe("install");
  });

  it("install wins over denied on iOS", () => {
    expect(planPushEnable({ ...base, iOS: true, permission: "denied" })).toBe(
      "install",
    );
  });

  it("denied when the browser permission is denied", () => {
    expect(planPushEnable({ ...base, permission: "denied" })).toBe("denied");
  });

  it("skipped when web push or the vapid key is missing", () => {
    expect(planPushEnable({ ...base, webPushSupported: false })).toBe("skipped");
    expect(planPushEnable({ ...base, vapidKey: "" })).toBe("skipped");
    expect(
      planPushEnable({ ...base, permission: "unsupported" }),
    ).toBe("skipped");
  });

  it("prompt otherwise", () => {
    expect(planPushEnable(base)).toBe("prompt");
  });
});
