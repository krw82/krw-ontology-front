const DEFAULT_ADMIN_EMAILS = [
  "admin1@example.com",
  "admin2@example.com",
  "dev@krw-ontology.local",
];

function getDefaultAdminEmails() {
  return process.env.NODE_ENV === "production" ? [] : DEFAULT_ADMIN_EMAILS;
}

export function isAdminEntitlementEmail(email?: string | null): boolean {
  if (!email) return false;
  const normalizedEmail = email.trim().toLowerCase();
  const configuredEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...getDefaultAdminEmails(), ...configuredEmails]).has(
    normalizedEmail,
  );
}
