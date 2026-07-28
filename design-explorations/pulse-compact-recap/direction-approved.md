# Pulse feed direction approved

> Recorded: 2026-07-26 (KST)

## Direction shown

Three compact recap prototypes were shown before implementation:

- `prototypes/a-quiet-recap.html` — single compact recap list
- `prototypes/b-research-ledger.html` — evidence-led ledger
- `prototypes/c-company-thread.html` — company-grouped thread

## User feedback and selected direction

The user rejected a full replacement feed and said:

> “아니다 지금같이 하는게 나을듯. 그냥 별로네. 대신에 카드 내부 디자인만 좀 조정하면 될듯”

The user then supplied a mobile thread-style feed reference and asked whether that direction would work. The selected implementation interpretation is:

> Keep the existing Pulse ordering, data model, item types, and research actions. Replace the visual card grammar with a **flat, thread-like research feed**: a left company identity anchor, a compact metadata line, an evidence-led change statement, a quiet source/action line, and thin dividers instead of rounded/shadowed cards, coloured rails, repeated explanatory labels, and large CTAs.

The active user goal is:

> “수정 진행해줘.”

## Reference assets

- User-supplied thread-style reference: `~/Downloads/KakaoTalk_Photo_2026-07-26-14-27-48.png`
- Current local Pulse capture: `../../.lazyweb/design-improve/pulse-2026-07-26/references/current-mobile.png`

## Implementation boundaries

- Do not copy social reactions, engagement counts, avatars, or social navigation.
- Do retain company logo, source evidence, urgency, research context, primary navigation, and analytics events.
- Use the existing KRW.O brand assets and tokens documented in `brand-spec.md`.
