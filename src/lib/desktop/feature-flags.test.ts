import { afterEach, describe, expect, it } from "vitest";
import {
  isDesktopRemoteResourcesEnabled,
  requireDesktopRemoteResourcesEnabled,
} from "./feature-flags";

const original = process.env.KRW_DESKTOP_REMOTE_RESOURCES_ENABLED;

afterEach(() => {
  if (original === undefined) {
    delete process.env.KRW_DESKTOP_REMOTE_RESOURCES_ENABLED;
  } else {
    process.env.KRW_DESKTOP_REMOTE_RESOURCES_ENABLED = original;
  }
});

describe("Desktop remote resources feature flag", () => {
  it("is enabled by default and can be disabled for staged rollout", () => {
    delete process.env.KRW_DESKTOP_REMOTE_RESOURCES_ENABLED;
    expect(isDesktopRemoteResourcesEnabled()).toBe(true);

    process.env.KRW_DESKTOP_REMOTE_RESOURCES_ENABLED = "false";
    expect(isDesktopRemoteResourcesEnabled()).toBe(false);
    expect(() => requireDesktopRemoteResourcesEnabled()).toThrow(
      "Desktop remote resources are disabled",
    );
  });
});
