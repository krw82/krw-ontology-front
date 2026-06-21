import type { Metadata } from "next";
import { notFound } from "next/navigation";
import DevComponentsGallery from "./DevComponentsGallery";

export const metadata: Metadata = {
  title: "Dev Components",
};

export const dynamic = "force-dynamic";

export default function DevComponentsPage() {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  return <DevComponentsGallery />;
}
