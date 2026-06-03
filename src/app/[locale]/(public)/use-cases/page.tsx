import { notFound, permanentRedirect } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { localizedPath } from "@/i18n/routing";

type UseCasesIndexPageProps = {
  params: Promise<{ locale: string }>;
};

export default async function UseCasesIndexPage({
  params,
}: UseCasesIndexPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  permanentRedirect(localizedPath(locale, "/questions"));
}
