import type { SupabaseClient } from "@supabase/supabase-js";

import type { UserFilingNotificationRow } from "@/types/database";

type Db = SupabaseClient;

/**
 * The delivery table is intentionally source-neutral. A notification can be
 * backed by a filing or a verified market issue, but it reaches a browser by
 * exactly the same owned-device queue.
 */
export async function queuePushDeliveries(input: {
  db: Db;
  notifications: ReadonlyArray<Pick<UserFilingNotificationRow, "id" | "user_id">>;
}): Promise<void> {
  if (!input.notifications.length) return;

  const userIds = Array.from(new Set(input.notifications.map((notification) => notification.user_id)));
  const { data: subscriptions, error } = await input.db
    .from("push_subscriptions")
    .select("id, user_id")
    .in("user_id", userIds)
    .eq("status", "active");
  if (error) throw new Error(`Failed to load push subscriptions for notification fanout: ${error.message}`);

  const pushIdsByUser = new Map<string, string[]>();
  for (const subscription of subscriptions ?? []) {
    const ids = pushIdsByUser.get(subscription.user_id) ?? [];
    ids.push(subscription.id);
    pushIdsByUser.set(subscription.user_id, ids);
  }

  const deliveries = input.notifications.flatMap((notification) =>
    (pushIdsByUser.get(notification.user_id) ?? []).map((subscriptionId) => ({
      notification_id: notification.id,
      subscription_id: subscriptionId,
    })),
  );
  if (!deliveries.length) return;

  const { error: deliveryError } = await input.db
    .from("filing_notification_deliveries")
    .upsert(deliveries, { onConflict: "notification_id,subscription_id", ignoreDuplicates: true });
  if (deliveryError) throw new Error(`Failed to queue notification push deliveries: ${deliveryError.message}`);
}
