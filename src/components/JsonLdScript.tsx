export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

interface JsonLdScriptProps {
  data: unknown;
  nonce?: string;
}

export default function JsonLdScript({ data, nonce }: JsonLdScriptProps) {
  return (
    <script
      nonce={nonce}
      type="application/ld+json"
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
