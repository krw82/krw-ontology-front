interface WorkspaceRouteLoadingProps {
  rows?: number;
}

export default function WorkspaceRouteLoading({
  rows = 3,
}: WorkspaceRouteLoadingProps) {
  return (
    <div
      className="motion-route-loading bg-canvas text-ink"
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
        <div className="motion-loading-block h-4 w-28 rounded-full bg-surface-strong" />
        <div className="motion-loading-block mt-3 h-9 w-52 max-w-[72%] rounded-[8px] bg-surface-strong" />
        <div className="motion-loading-block mt-3 h-4 w-full max-w-lg rounded-full bg-surface-strong" />

        <div className="mt-xl space-y-base" aria-hidden="true">
          {Array.from({ length: rows }, (_, index) => (
            <div
              key={index}
              className="rounded-[16px] border border-hairline bg-surface px-base py-lg"
            >
              <div className="flex items-center gap-3">
                <div className="motion-loading-block h-11 w-11 rounded-[8px] bg-surface-strong" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="motion-loading-block h-3 w-24 rounded-full bg-surface-strong" />
                  <div className="motion-loading-block h-4 w-16 rounded-full bg-surface-strong" />
                </div>
              </div>
              <div className="motion-loading-block mt-base h-6 w-[82%] rounded-[8px] bg-surface-strong" />
              <div className="motion-loading-block mt-3 h-4 w-full rounded-full bg-surface-strong" />
              <div className="motion-loading-block mt-2 h-4 w-[68%] rounded-full bg-surface-strong" />
              <div className="motion-loading-block mt-base h-11 w-32 rounded-[8px] bg-surface-strong" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
