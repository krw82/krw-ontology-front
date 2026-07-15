import { notFound } from "next/navigation";
import PublicFooter from "@/components/PublicFooter";
import { isLocale } from "@/i18n/config";

export default async function PublicLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return (
    <>
      {children}
      <PublicFooter locale={locale} />
    </>
  );
}
