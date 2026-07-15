import { z } from "zod";

export const pulseLearningEntrySchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  kind: z.enum(["explainer", "checklist", "four_panel"]),
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(600),
  action_label: z.string().min(1).max(80),
  action_href: z.string().min(1).max(2_000),
  source_label: z.string().min(1).max(120),
  source_href: z.string().min(1).max(2_000),
  active_from: z.iso.datetime(),
  active_until: z.iso.datetime(),
  panels: z.tuple([
    z.string().min(1).max(120),
    z.string().min(1).max(120),
    z.string().min(1).max(120),
    z.string().min(1).max(120),
  ]).optional(),
}).superRefine((entry, context) => {
  if (Date.parse(entry.active_until) <= Date.parse(entry.active_from)) {
    context.addIssue({ code: "custom", path: ["active_until"], message: "active_until must follow active_from" });
  }
  if (entry.kind === "four_panel" && !entry.panels) {
    context.addIssue({ code: "custom", path: ["panels"], message: "four_panel content requires four text panels" });
  }
});

export const pulseLearningManifestSchema = z.array(pulseLearningEntrySchema).min(1);
