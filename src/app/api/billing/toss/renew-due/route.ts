import { renewDueTossSubscriptions } from "@/lib/billing/toss-subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const secret = process.env.BILLING_CRON_SECRET;
  if (!secret) return false;
  return (
    request.headers.get("authorization") === `Bearer ${secret}` ||
    request.headers.get("x-billing-cron-secret") === secret
  );
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json(
      {
        error: {
          code: "forbidden",
          message: "Billing cron authorization required",
        },
      },
      { status: 403 },
    );
  }

  try {
    const result = await renewDueTossSubscriptions();
    return Response.json(result);
  } catch {
    return Response.json(
      {
        error: {
          code: "billing_renewal_failed",
          message: "Due subscription renewal failed",
        },
      },
      { status: 500 },
    );
  }
}
