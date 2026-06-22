import { redirect } from "next/navigation";
import { KrwBrand } from "@/components/KrwBrand";
import { getAuthUser } from "@/lib/auth";
import {
  desktopAuthIdentifierHash,
  logDesktopAuthEvent,
} from "@/lib/desktop/auth-events";
import { getDesktopAuthorizationRequestForWeb } from "@/lib/desktop/authorization";
import { DesktopConnectClient } from "./DesktopConnectClient";

export const dynamic = "force-dynamic";

export default async function DesktopConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string }>;
}) {
  const requestId = (await searchParams).request?.trim() ?? "";
  if (!requestId) {
    return <InvalidRequest message="Desktop 로그인 요청이 없습니다." />;
  }

  const user = await getAuthUser();
  if (!user) {
    const next = `/desktop/connect?request=${encodeURIComponent(requestId)}`;
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  const authorization =
    await getDesktopAuthorizationRequestForWeb(requestId);
  if (!authorization) {
    return <InvalidRequest message="Desktop 로그인 요청을 찾을 수 없습니다." />;
  }

  if (authorization.status !== "pending") {
    const message =
      authorization.status === "expired"
        ? "Desktop 로그인 요청이 만료되었습니다. 앱에서 다시 시작해주세요."
        : "이 Desktop 로그인 요청은 이미 처리되었습니다.";
    return <InvalidRequest message={message} />;
  }
  logDesktopAuthEvent("auth_web_signed_in", {
    request_id_hash: desktopAuthIdentifierHash(authorization.id),
    attempt_id_hash: desktopAuthIdentifierHash(authorization.state),
    user_id_hash: desktopAuthIdentifierHash(user.id),
    status: "succeeded",
  });

  return (
    <main className="min-h-[100dvh] bg-canvas text-ink">
      <header className="border-b border-hairline bg-canvas">
        <div className="mx-auto flex h-[72px] max-w-[1120px] items-center px-base sm:px-md">
          <KrwBrand compact />
        </div>
      </header>
      <section className="mx-auto flex w-full max-w-[720px] flex-col px-base py-xl sm:px-md sm:py-2xl">
        <p className="text-[13px] font-bold text-primary">KRW Desktop</p>
        <h1 className="mt-2 text-[30px] font-black leading-tight sm:text-[38px]">
          이 Mac을 계정에 연결
        </h1>
        <p className="mt-3 text-[15px] leading-6 text-body">
          연결하면 KRW 이용권과 AI 모델 접근 권한을 이 기기에서 사용할 수
          있습니다.
        </p>

        <DesktopConnectClient
          requestId={authorization.id}
          accountEmail={user.email ?? "로그인된 KRW 계정"}
          deviceName={authorization.device_name}
          platform={authorization.platform}
          arch={authorization.arch}
          appVersion={authorization.app_version}
        />
      </section>
    </main>
  );
}

function InvalidRequest({ message }: { message: string }) {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-canvas px-base text-ink">
      <section className="w-full max-w-[560px] border border-hairline bg-canvas p-lg">
        <KrwBrand compact />
        <h1 className="mt-lg text-[26px] font-black">Desktop 연결 불가</h1>
        <p className="mt-sm text-[15px] leading-6 text-body">{message}</p>
      </section>
    </main>
  );
}
