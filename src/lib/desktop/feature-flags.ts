import "server-only";

import { DesktopContractError } from "./ontology-contracts";

export function isDesktopRemoteResourcesEnabled() {
  const value = process.env.KRW_DESKTOP_REMOTE_RESOURCES_ENABLED;
  if (value === undefined || value.trim() === "") return true;
  return !["0", "false", "off", "no"].includes(value.trim().toLowerCase());
}

export function requireDesktopRemoteResourcesEnabled() {
  if (isDesktopRemoteResourcesEnabled()) return;
  throw new DesktopContractError("Desktop remote resources are disabled", {
    code: "not_found",
    publicMessage: "요청한 Desktop 기능을 사용할 수 없습니다.",
    status: 404,
  });
}
