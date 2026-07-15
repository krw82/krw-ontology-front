import "server-only";

import { getEntitlementStatus } from "./entitlement";
import {
  getFeatureSplitMode,
  isEntitlementFeatureEnabled,
  type MenuFeatureKey,
} from "./feature-access";

export async function canAccessMenuFeature(
  userId: string,
  userEmail: string | null | undefined,
  featureKey: MenuFeatureKey,
): Promise<boolean> {
  if (getFeatureSplitMode() === "off") return true;

  const entitlement = await getEntitlementStatus(userId, userEmail ?? null);
  return isEntitlementFeatureEnabled(entitlement, featureKey);
}
