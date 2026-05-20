export const DEV_AUTH_USER_ID = "00000000-0000-4000-8000-000000000001";
export const DEV_AUTH_EMAIL = "dev@krw-ontology.local";
export const DEV_AUTH_NAME = "Dev User";

export function isDevAuthBypassEnabled(): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === "1"
  );
}
