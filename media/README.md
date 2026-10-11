# media/ — CC0 asset manifest

All exercise demo media is **AI-generated original**, dedicated to the public
domain under **CC0 1.0**. No third-party photos, illustrations, or video are
used — this keeps the KB's MIT/CC-BY licensing clean.

## Conventions

- Naming: `<exercise-id>_<view>_<n>.webp` (stills), e.g.
  `goblet-squat_front_01.webp`. Clips later, spec'd conservatively.
- Stills first (GTX 1070 class hardware); video clips only when the media
  spec's quality bar is met.

## Per-asset record (required)

Every asset committed here must be recorded in `media/manifest.json`:

```json
{
  "file": "goblet-squat_front_01.webp",
  "exerciseId": "goblet-squat",
  "service": "<generating service>",
  "model": "<model name + version>",
  "prompt": "<full prompt>",
  "licenseCheck": "Terms reviewed <date>; output ownership assigned to user; CC0 dedication applied.",
  "coachReviewed": false,
  "reviewedBy": null,
  "reviewDate": null
}
```

## Merge gate

`coachReviewed` must be `true` before an asset ships in a bundle release.
AI anatomy errors are a **safety liability** — a wrong joint angle in a demo
image can injure someone. No exceptions.

`reviewedBy` records the reviewer's role or handle (e.g. `"coach:lead"`),
never a personal name — no PII in the manifest.
