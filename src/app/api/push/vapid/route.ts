export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A VAPID public key is intentionally public. Serving it here lets the service
// worker renew a browser-rotated subscription without bundling deployment
// configuration into public/sw.js.
export async function GET() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  if (!publicKey) {
    return Response.json(
      { error: { code: "not_configured", message: "푸시 알림이 아직 설정되지 않았습니다." } },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  return Response.json(
    { publicKey },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
