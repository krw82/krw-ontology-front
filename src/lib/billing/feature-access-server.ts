import "server-only";

import { getEntitlementStatus } from "./entitlement";
import {
  getFeatureSplitMode,
  getMenuFeatureDefinition,
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

/**
 * Route handlers use this after authentication so a hidden menu cannot be
 * bypassed by calling a notebook endpoint directly.
 */
export async function requireMenuFeatureAccess(
  userId: string,
  userEmail: string | null | undefined,
  featureKey: MenuFeatureKey,
): Promise<Response | null> {
  if (await canAccessMenuFeature(userId, userEmail, featureKey)) return null;

  const feature = getMenuFeatureDefinition(featureKey);
  const requiredPlan =
    feature.required_plan.charAt(0).toUpperCase() +
    feature.required_plan.slice(1);
  return Response.json(
    {
      error: {
        code: "forbidden",
        message: `${feature.label}은 ${requiredPlan} 플랜부터 사용할 수 있습니다.`,
      },
    },
    { status: 403 },
  );
}
