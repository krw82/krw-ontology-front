# Pulse compact recap · three direction spec

## Shared assumption

This is a mobile-first research feed for a user who wants to scan what changed across followed companies, decide whether an item is worth opening, and continue prior research without being asked to read a long AI-generated narrative first. The prototype uses labelled sample data only.

## Form derivation

| Question | Answer |
| --- | --- |
| Narrative role | A daily / since-last-visit research recap, not a dashboard or chat landing page. |
| Viewing distance | Phone at arm’s length, so titles stay 16–18px and tap rows remain at least 56px high. |
| Visual temperature | Calm, editorial, institutional. The feed should feel like a clean market notebook rather than a generative assistant. |
| Capacity | 4–6 useful updates should appear before the user needs to scroll far; every item uses one concise change line and one evidence/context line. |
| Visual motif | A research ledger: time, company, change, and evidence are recorded in a deliberate reading order. |

## Shared system

- Existing KRW.O blue is used only for navigational hierarchy and source links.
- White canvas plus a warm off-white recap strip create separation without floaty cards.
- Thin rules replace card shadows and coloured rails.
- A company ticker, event type, and time form the compact metadata layer; the change is the only line that gets strong visual weight.
- Rows are the action surface. There are no redundant full-width black CTAs.

## Directions

### A · Quiet recap

The closest answer to the Quartr reference: one calm chronological list with a concise “since your last visit” frame. **Form comes from the literal recap email/list** — each update is a single, scannable record.

### B · Research ledger

The most evidence-oriented direction: explicit columns make the feed feel like a compact analyst record. **Form comes from a filing ledger** — the reader can compare time, company, change, and source at a glance.

### C · Company thread

The most continuity-oriented direction: related events sit under a company heading while preserving compact row density. **Form comes from the user’s company-following context** — activity and prior research read as one thread, rather than unrelated cards.

## Explicitly out of scope

- Production component migration, feed ranking changes, event copy generation, and backend data changes.
- Any claim that the sample rows are current company events.
- A selected direction must be recorded in `direction-approved.md` before production implementation begins.
