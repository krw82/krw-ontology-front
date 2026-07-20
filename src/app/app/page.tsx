import { redirect } from "next/navigation";

/**
 * Stable entry point for the installed app.
 *
 * Keeping the manifest pointed at this resolver lets the product home change
 * without requiring users to reinstall the PWA. Authentication and
 * entitlement routing remain owned by the destination page.
 */
export default function InstalledAppEntryPage() {
  redirect("/pulse?source=pwa");
}
