export const DEV_AUTH_USER_ID = "00000000-0000-4000-8000-000000000001";
export const DEV_AUTH_EMAIL = "dev@krw-ontology.local";
export const DEV_AUTH_NAME = "Dev User";

export function isLocalDevHost(hostname: string | null | undefined): boolean {
  const normalized = hostname?.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
}
