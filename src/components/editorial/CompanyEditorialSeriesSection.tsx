"use client";

import { useMemo, useState } from "react";
import EditorialImageCarousel, { type EditorialCarouselSlide } from "@/components/editorial/EditorialImageCarousel";

export interface CompanyEditorialEpisode {
  id: string;
  number: number;
  title: string;
  body: string;
  slides: EditorialCarouselSlide[];
}

export interface CompanyEditorialSeries {
  id: string;
  slug: string;
  title: string;
  summary: string;
  episodes: CompanyEditorialEpisode[];
}

interface CompanyEditorialSeriesSectionProps {
  series: CompanyEditorialSeries[];
}

/** The company page is the permanent home of a story; Pulse only reuses it. */
export default function CompanyEditorialSeriesSection({ series }: CompanyEditorialSeriesSectionProps) {
  const [seriesIndex, setSeriesIndex] = useState(0);
  const [episodeIndex, setEpisodeIndex] = useState(0);
  const activeSeries = series[Math.min(seriesIndex, series.length - 1)];
  const activeEpisode = activeSeries?.episodes[Math.min(episodeIndex, activeSeries.episodes.length - 1)];
  const availableSeries = useMemo(() => series.filter((item) => item.episodes.length > 0), [series]);

  if (!activeSeries || !activeEpisode || availableSeries.length === 0) return null;

  return (
    <section className="border-b border-hairline py-7 sm:py-9" aria-label="회사 이야기">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(360px,0.95fr)] lg:items-start lg:gap-10">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-black uppercase tracking-[0.16em] text-primary">Company story</p>
          <h2 className="mt-2 text-[24px] font-black leading-8 tracking-[-0.035em] text-ink sm:text-[28px]">이 회사를 한 장씩 이해하기</h2>

          {availableSeries.length > 1 ? <div className="mt-5 flex flex-wrap gap-2" role="tablist" aria-label="회사 이야기 시리즈">
            {availableSeries.map((item, index) => <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={seriesIndex === index}
              onClick={() => {
                setSeriesIndex(index);
                setEpisodeIndex(0);
              }}
              className={`rounded-full border px-3 py-2 text-[12px] font-extrabold transition ${seriesIndex === index ? "border-ink bg-ink text-white" : "border-hairline bg-white text-body hover:border-ink"}`}
            >{item.title}</button>)}
          </div> : null}

          <div className="mt-5 border-l-2 border-primary pl-4">
            <h3 className="text-[18px] font-black leading-7 text-ink">{activeEpisode.title}</h3>
          </div>

          {activeSeries.episodes.length > 1 ? <div className="mt-5 flex flex-wrap gap-2" aria-label="에피소드 선택">
            {activeSeries.episodes.map((episode, index) => <button
              key={episode.id}
              type="button"
              onClick={() => setEpisodeIndex(index)}
              aria-current={episodeIndex === index ? "true" : undefined}
              className={`min-h-9 rounded-[8px] px-3 text-[12px] font-extrabold transition ${episodeIndex === index ? "bg-primary text-white" : "bg-surface-soft text-body hover:bg-primary-fixed"}`}
            >{String(episode.number).padStart(2, "0")}</button>)}
          </div> : null}
        </div>

        <EditorialImageCarousel
          slides={activeEpisode.slides}
          ariaLabel={`${activeSeries.title} ${activeEpisode.title} 슬라이드`}
          className="mx-auto w-full max-w-[500px]"
        />
      </div>
    </section>
  );
}
