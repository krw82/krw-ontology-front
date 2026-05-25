const DEFAULT_ADMIN_EMAILS = [
  "admin1@example.com",
  "admin2@example.com",
];

export function isAdminEntitlementEmail(email?: string | null): boolean {
  if (!email) return false;
  const normalizedEmail = email.trim().toLowerCase();
  const configuredEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...DEFAULT_ADMIN_EMAILS, ...configuredEmails]).has(
    normalizedEmail,
  );
}
