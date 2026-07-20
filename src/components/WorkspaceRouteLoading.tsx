interface WorkspaceRouteLoadingProps {
  rows?: number;
}

export default function WorkspaceRouteLoading({
  rows = 3,
}: WorkspaceRouteLoadingProps) {
  return (
    <div
      className="bg-canvas text-ink"
      role="status"
      aria-busy="true"
      aria-label="페이지 불러오는 중"
      data-workspace-route-loading
    >
      <main
        id="main-content"
        className="mx-auto w-full max-w-3xl px-base py-xl sm:px-md md:px-xl md:py-2xl"
      >
        <span className="sr-only">페이지를 불러오고 있습니다.</span>
        <div className="h-4 w-28 animate-pulse rounded-full bg-surface-strong" />
        <div className="mt-3 h-9 w-52 max-w-[72%] animate-pulse rounded-[8px] bg-surface-strong" />
        <div className="mt-3 h-4 w-full max-w-lg animate-pulse rounded-full bg-surface-strong" />

        <div className="mt-xl space-y-base" aria-hidden="true">
          {Array.from({ length: rows }, (_, index) => (
            <div
              key={index}
              className="rounded-[16px] border border-hairline bg-surface px-base py-lg"
            >
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 animate-pulse rounded-[8px] bg-surface-strong" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-3 w-24 animate-pulse rounded-full bg-surface-strong" />
                  <div className="h-4 w-16 animate-pulse rounded-full bg-surface-strong" />
                </div>
              </div>
              <div className="mt-base h-6 w-[82%] animate-pulse rounded-[8px] bg-surface-strong" />
              <div className="mt-3 h-4 w-full animate-pulse rounded-full bg-surface-strong" />
              <div className="mt-2 h-4 w-[68%] animate-pulse rounded-full bg-surface-strong" />
              <div className="mt-base h-11 w-32 animate-pulse rounded-[8px] bg-surface-strong" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
