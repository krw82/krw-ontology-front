import { notFound, redirect } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { localizedPath } from "@/i18n/routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StartPageProps = {
  params: Promise<{ locale: string }>;
};

export default async function StartPage({
  params,
}: StartPageProps) {
  const { locale: rawLocale } = await params;
  if (!isLocale(rawLocale)) notFound();

  // v2's company-choice screen is retired. Preserve old links by sending
  // them to the same company directory that first-time sign-ins now receive.
  redirect(localizedPath(rawLocale, "/companies"));
}
