import { APP_VERSION } from "@/lib/app-version";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    {
      status: "ok",
      deployment_id: APP_VERSION,
      timestamp: new Date().toISOString(),
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
