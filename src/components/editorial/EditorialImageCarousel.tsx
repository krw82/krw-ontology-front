"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useRef, useState } from "react";
import EditorialStoryViewer from "@/components/editorial/EditorialStoryViewer";

export interface EditorialCarouselSlide {
  src: string;
  alt: string;
  width?: number | null;
  height?: number | null;
}

interface EditorialImageCarouselProps {
  slides: EditorialCarouselSlide[];
  ariaLabel: string;
  className?: string;
  aspectClassName?: string;
  onSlideChange?: (index: number) => void;
}

/**
 * Native horizontal scrolling keeps the interaction familiar on touch devices.
 * Only the current/adjacent images receive a source to avoid eagerly loading a
 * complete 6–8 page illustrated story inside a compact Pulse card.
 */
export default function EditorialImageCarousel({
  slides,
  ariaLabel,
  className = "",
  aspectClassName = "aspect-[2/3]",
  onSlideChange,
}: EditorialImageCarouselProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const previewPointerOriginRef = useRef<{ x: number; y: number } | null>(null);
  const previewPointerMovedRef = useRef(false);
  const viewerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const viewerOpenedWithPointerRef = useRef(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const hasMultipleSlides = slides.length > 1;

  const changeSlide = useCallback((nextIndex: number, behavior: ScrollBehavior = "smooth") => {
    const bounded = Math.max(0, Math.min(nextIndex, slides.length - 1));
    setActiveIndex(bounded);
    onSlideChange?.(bounded);
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({ left: bounded * viewport.clientWidth, behavior });
  }, [onSlideChange, slides.length]);

  const updateFromScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || viewport.clientWidth === 0) return;
    const nextIndex = Math.max(0, Math.min(
      slides.length - 1,
      Math.round(viewport.scrollLeft / viewport.clientWidth),
    ));
    setActiveIndex((current) => {
      if (current === nextIndex) return current;
      onSlideChange?.(nextIndex);
      return nextIndex;
    });
  }, [onSlideChange, slides.length]);

  const openViewer = useCallback((
    index: number,
    trigger: HTMLButtonElement,
    openedWithPointer: boolean,
  ) => {
    const didMove = previewPointerMovedRef.current;
    previewPointerOriginRef.current = null;
    previewPointerMovedRef.current = false;
    if (didMove) {
      return;
    }

    viewerTriggerRef.current = trigger;
    viewerOpenedWithPointerRef.current = openedWithPointer;

    // A pointer user does not need a persistent keyboard focus indicator. Blur
    // before the native dialog opens so it has no preview button to restore on
    // close. Keyboard and assistive-technology activation keep their focus.
    if (openedWithPointer) trigger.blur();

    setActiveIndex(index);
    onSlideChange?.(index);
    setViewerOpen(true);
  }, [onSlideChange]);

  const closeViewer = useCallback(() => {
    const trigger = viewerTriggerRef.current;
    const openedWithPointer = viewerOpenedWithPointerRef.current;

    viewerTriggerRef.current = null;
    viewerOpenedWithPointerRef.current = false;
    setViewerOpen(false);

    if (openedWithPointer) {
      // `dialog.close()` can restore focus during the unmount cleanup. Run one
      // frame later as a fallback for mobile browsers that restore it there.
      window.requestAnimationFrame(() => trigger?.blur());
    }
  }, []);

  if (slides.length === 0) return null;

  return (
    <section className={`min-w-0 ${className}`} aria-label={ariaLabel}>
      <div
        className="group/carousel relative overflow-hidden rounded-[14px] bg-white"
        role="region"
        aria-roledescription="carousel"
        aria-label={ariaLabel}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            changeSlide(activeIndex - 1);
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            changeSlide(activeIndex + 1);
          }
        }}
      >
        <div
          ref={viewportRef}
          className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onScroll={updateFromScroll}
        >
          {slides.map((slide, index) => {
            const shouldLoad = Math.abs(index - activeIndex) <= 1;
            return (
              <figure
                key={`${slide.src}-${index}`}
                className={`relative w-full shrink-0 snap-center ${aspectClassName}`}
                aria-roledescription="slide"
                aria-label={`${index + 1} / ${slides.length}`}
              >
                <button
                  type="button"
                  tabIndex={index === activeIndex ? 0 : -1}
                  aria-label={`${index + 1}번째 슬라이드 확대해서 보기`}
                  onPointerDown={(event) => {
                    previewPointerOriginRef.current = { x: event.clientX, y: event.clientY };
                    previewPointerMovedRef.current = false;
                  }}
                  onPointerMove={(event) => {
                    const origin = previewPointerOriginRef.current;
                    if (!origin) return;
                    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10) {
                      previewPointerMovedRef.current = true;
                    }
                  }}
                  onPointerCancel={() => {
                    previewPointerOriginRef.current = null;
                    previewPointerMovedRef.current = false;
                  }}
                  onClick={(event) => openViewer(index, event.currentTarget, event.detail > 0)}
                  className="block h-full w-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                >
                  {shouldLoad ? (
                    <img
                      src={slide.src}
                      alt={slide.alt}
                      width={slide.width ?? undefined}
                      height={slide.height ?? undefined}
                      loading={index === 0 ? "eager" : "lazy"}
                      decoding="async"
                      draggable={false}
                      className="h-full w-full select-none object-contain"
                    />
                  ) : <div className="h-full w-full bg-[#f3f6fb]" aria-hidden="true" />}
                </button>
              </figure>
            );
          })}
        </div>

        {hasMultipleSlides ? <>
          <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/60 px-2.5 py-1 font-mono text-[11px] font-bold tracking-[0.08em] text-white" aria-live="polite">
            {String(activeIndex + 1).padStart(2, "0")} / {String(slides.length).padStart(2, "0")}
          </span>
          <button type="button" onClick={() => changeSlide(activeIndex - 1)} disabled={activeIndex === 0} aria-label="이전 슬라이드" className="absolute left-3 top-1/2 hidden h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-white/70 bg-white/90 text-ink shadow-sm transition hover:bg-white disabled:opacity-0 group-focus-within/carousel:grid group-hover/carousel:grid md:grid">
            <span className="material-symbols-outlined text-[20px]" aria-hidden="true">arrow_back</span>
          </button>
          <button type="button" onClick={() => changeSlide(activeIndex + 1)} disabled={activeIndex === slides.length - 1} aria-label="다음 슬라이드" className="absolute right-3 top-1/2 hidden h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-white/70 bg-white/90 text-ink shadow-sm transition hover:bg-white disabled:opacity-0 group-focus-within/carousel:grid group-hover/carousel:grid md:grid">
            <span className="material-symbols-outlined text-[20px]" aria-hidden="true">arrow_forward</span>
          </button>
        </> : null}
      </div>

      {hasMultipleSlides ? <div className="mt-2 flex items-center justify-between gap-3 px-0.5">
        <p className="text-[11px] font-semibold text-muted">좌우로 넘겨보기 · 탭해서 크게 보기</p>
        <div className="flex items-center gap-1.5" role="tablist" aria-label="슬라이드 선택">
          {slides.map((slide, index) => <button
            key={`${slide.src}-dot-${index}`}
            type="button"
            role="tab"
            aria-selected={index === activeIndex}
            aria-label={`${index + 1}번째 슬라이드 보기`}
            onClick={() => changeSlide(index)}
            className={`h-1.5 rounded-full transition-all ${index === activeIndex ? "w-6 bg-primary" : "w-1.5 bg-outline-variant/45 hover:bg-outline-variant"}`}
          />)}
        </div>
      </div> : null}
      {viewerOpen ? <EditorialStoryViewer
        slides={slides}
        ariaLabel={`${ariaLabel} 크게 보기`}
        initialIndex={activeIndex}
        onClose={closeViewer}
        onSlideChange={(index) => changeSlide(index, "auto")}
      /> : null}
    </section>
  );
}
