"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

interface StoryViewerSlide {
  src: string;
  alt: string;
  width?: number | null;
  height?: number | null;
}

interface EditorialStoryViewerProps {
  slides: StoryViewerSlide[];
  ariaLabel: string;
  initialIndex: number;
  onClose: () => void;
  onSlideChange?: (index: number) => void;
}

interface PointerOrigin {
  x: number;
  y: number;
}

function boundedIndex(index: number, length: number): number {
  return Math.max(0, Math.min(index, Math.max(0, length - 1)));
}

/**
 * A focused reading surface for illustrated company stories.
 * Empty space around the image is intentionally tappable: it returns the
 * reader to the in-page carousel without putting controls over the artwork.
 */
export default function EditorialStoryViewer({
  slides,
  ariaLabel,
  initialIndex,
  onClose,
  onSlideChange,
}: EditorialStoryViewerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const backdropPointerRef = useRef<PointerOrigin | null>(null);
  const initialIndexRef = useRef(boundedIndex(initialIndex, slides.length));
  const [activeIndex, setActiveIndex] = useState(() => boundedIndex(initialIndex, slides.length));
  const hasMultipleSlides = slides.length > 1;

  const scrollToIndex = useCallback((nextIndex: number, behavior: ScrollBehavior = "smooth") => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({ left: boundedIndex(nextIndex, slides.length) * viewport.clientWidth, behavior });
  }, [slides.length]);

  const changeSlide = useCallback((nextIndex: number, behavior: ScrollBehavior = "smooth") => {
    const bounded = boundedIndex(nextIndex, slides.length);
    setActiveIndex(bounded);
    onSlideChange?.(bounded);
    scrollToIndex(bounded, behavior);
  }, [onSlideChange, scrollToIndex, slides.length]);

  const updateFromScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || viewport.clientWidth === 0) return;
    const nextIndex = boundedIndex(Math.round(viewport.scrollLeft / viewport.clientWidth), slides.length);
    setActiveIndex((current) => {
      if (current === nextIndex) return current;
      onSlideChange?.(nextIndex);
      return nextIndex;
    });
  }, [onSlideChange, slides.length]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const viewport = viewportRef.current;
    if (!dialog || !viewport) return;

    if (!dialog.open) dialog.showModal();

    // This must be a direct assignment before the first paint. Calling
    // scrollTo(..., "auto") in a later frame lets the first slide flash, and
    // the viewport's CSS smooth-scroll rule can turn that jump into motion.
    const initialSlide = boundedIndex(initialIndexRef.current, slides.length);
    viewport.scrollLeft = initialSlide * viewport.clientWidth;

    // The preview button remains behind this translucent dialog. Move focus
    // into the dialog so its visible focus ring is not seen through the
    // backdrop while preserving keyboard focus styling everywhere else.
    closeButtonRef.current?.focus({ preventScroll: true });

    return () => {
      if (dialog.open) dialog.close();
    };
  }, [slides.length]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  if (slides.length === 0) return null;

  const stopMotion = typeof window !== "undefined"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <dialog
      ref={dialogRef}
      aria-label={ariaLabel}
      className="fixed inset-0 m-0 h-[100dvh] w-[100dvw] max-h-none max-w-none border-0 bg-transparent p-0 text-ink backdrop:bg-transparent"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          changeSlide(activeIndex - 1, stopMotion ? "auto" : "smooth");
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          changeSlide(activeIndex + 1, stopMotion ? "auto" : "smooth");
        }
      }}
    >
      <div className="relative h-full w-full overflow-hidden bg-[#27364d]/75 backdrop-blur-sm">
        <div
          ref={viewportRef}
          className="flex h-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onScroll={updateFromScroll}
        >
          {slides.map((slide, index) => {
            const shouldLoad = Math.abs(index - activeIndex) <= 1;
            return (
              <figure
                key={`${slide.src}-${index}`}
                className="flex h-full w-full shrink-0 snap-center items-center justify-center px-4 pb-16 pt-16 sm:px-24 sm:pb-14 sm:pt-14"
                aria-roledescription="slide"
                aria-label={`${index + 1} / ${slides.length}`}
                onPointerDown={(event) => {
                  if (event.target === event.currentTarget) {
                    backdropPointerRef.current = { x: event.clientX, y: event.clientY };
                  }
                }}
                onPointerUp={(event) => {
                  const origin = backdropPointerRef.current;
                  backdropPointerRef.current = null;
                  if (!origin || event.target !== event.currentTarget) return;
                  const distance = Math.hypot(event.clientX - origin.x, event.clientY - origin.y);
                  if (distance < 10) onClose();
                }}
                onPointerCancel={() => {
                  backdropPointerRef.current = null;
                }}
              >
                {shouldLoad ? (
                  <img
                    src={slide.src}
                    alt={slide.alt}
                    width={slide.width ?? undefined}
                    height={slide.height ?? undefined}
                    loading={index === activeIndex ? "eager" : "lazy"}
                    decoding="async"
                    draggable={false}
                    className="h-auto max-h-[calc(100dvh-128px)] w-auto max-w-full select-none rounded-[10px] bg-white object-contain shadow-[0_24px_70px_rgba(16,24,40,0.3)] sm:max-h-[calc(100dvh-112px)]"
                  />
                ) : <div className="h-full w-full" aria-hidden="true" />}
              </figure>
            );
          })}
        </div>

        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between px-4 pt-[max(16px,env(safe-area-inset-top))] sm:px-6">
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="pointer-events-auto grid h-11 min-w-11 place-items-center rounded-full border border-white/25 bg-white/95 text-ink shadow-sm transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            aria-label="회사 이야기 닫기"
          >
            <span className="material-symbols-outlined text-[22px]" aria-hidden="true">close</span>
          </button>
          {hasMultipleSlides ? (
            <span className="rounded-full bg-black/45 px-3 py-1.5 font-mono text-[11px] font-bold tracking-[0.08em] text-white" aria-live="polite">
              {String(activeIndex + 1).padStart(2, "0")} / {String(slides.length).padStart(2, "0")}
            </span>
          ) : null}
        </div>

        {hasMultipleSlides ? <>
          <button
            type="button"
            onClick={() => changeSlide(activeIndex - 1, stopMotion ? "auto" : "smooth")}
            disabled={activeIndex === 0}
            aria-label="이전 슬라이드"
            className="absolute left-6 top-1/2 hidden h-12 w-12 -translate-y-1/2 place-items-center rounded-full border border-white/25 bg-white/95 text-ink shadow-lg transition hover:bg-white disabled:opacity-0 md:grid"
          >
            <span className="material-symbols-outlined text-[24px]" aria-hidden="true">arrow_back</span>
          </button>
          <button
            type="button"
            onClick={() => changeSlide(activeIndex + 1, stopMotion ? "auto" : "smooth")}
            disabled={activeIndex === slides.length - 1}
            aria-label="다음 슬라이드"
            className="absolute right-6 top-1/2 hidden h-12 w-12 -translate-y-1/2 place-items-center rounded-full border border-white/25 bg-white/95 text-ink shadow-lg transition hover:bg-white disabled:opacity-0 md:grid"
          >
            <span className="material-symbols-outlined text-[24px]" aria-hidden="true">arrow_forward</span>
          </button>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-4 pb-[max(16px,env(safe-area-inset-bottom))]">
            <div className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-black/35 px-3 py-2" role="tablist" aria-label="슬라이드 선택">
              {slides.map((slide, index) => (
                <button
                  key={`${slide.src}-viewer-dot-${index}`}
                  type="button"
                  role="tab"
                  aria-selected={activeIndex === index}
                  aria-label={`${index + 1}번째 슬라이드 보기`}
                  onClick={() => changeSlide(index, stopMotion ? "auto" : "smooth")}
                  className={`h-1.5 rounded-full transition-all ${index === activeIndex ? "w-5 bg-white" : "w-1.5 bg-white/45 hover:bg-white/75"}`}
                />
              ))}
            </div>
          </div>
        </> : null}
      </div>
    </dialog>
  );
}
