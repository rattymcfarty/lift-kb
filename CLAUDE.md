# CLAUDE.md — lift-kb

Content repository for **LIFT** (the app lives in `rattymcfarty/lift-app`).
**Start with the app repo's `CLAUDE.md` and `docs/ops/HANDOFF.md`** — they hold the
project-wide rules, state and recovery runbook. This file is the KB-specific part.

## What is here
- `content/exercises/<id>.md` — one exercise per page (`id` == filename), the **only source of
  truth**. YAML frontmatter carries the structured fields (`fields:` lists their original key
  order, which the bundle hash depends on); `## Heading` sections carry the prose lists
  (instructions, cues, mistakes, safety, longevity); everything else on the page is
  human-only and ignored by the parser. Schema: `schemas/exercise.schema.json`.
- `content/programs/<id>.md` — multi-week programs (`schemas/program.schema.json`).
- `content/README.md` — browsable index (keep it in step when adding pages).
- `scripts/lib/md-content.mjs` — the Markdown parser; `scripts/validate-content.mjs` — schema check.
- `kb-version.json` — current bundle version; `channel.json` — release channel
  (`latest`, `sha256`, …) which **must match a fresh build** (CI fails otherwise).
- `scripts/build-bundle.mjs` — validates ids/filenames and reads `content/*.md` and emits
  `dist/kb-bundle-<version>.json` (+ `.sha256`); `--write-channel` updates `channel.json`.
- `.github/workflows/validate.yml` — CI (maintained by hand; paste via the web UI,
  automation cannot write workflow files).

## Rules (do not break)
1. **IDs are permanent.** Never rename or delete. To retire an exercise set
   `"deprecated": true` and `"replacedBy": "<canonical-id>"` (the app's importer
   skips deprecated entries; user history keeps working).
2. **Live names are unique.** Same-name entries must differ meaningfully (different
   equipment/muscles) or one is deprecated. Check with the snippet in HANDOFF/recovery tests.
3. **Every exercise needs real, specific prose:** ≥ 2 instruction steps (aim 4–6),
   cues, common mistakes, a safety note for anything risky, `longevityNotes`.
   No templated filler. Coach review is the merge gate for public releases.
4. No expert/trainer names; cite publications. Prose is CC BY 4.0, original.
5. After any content change: bump `kb-version.json`, run
   `node scripts/build-bundle.mjs --write-channel`, validate
   (`node scripts/validate-content.mjs`),
   commit, push — then refresh the app snapshot:
   `node ~/lift/lift-app/scripts/sync-kb-snapshot.mjs ~/lift/lift-kb` in `lift-app`
   and run `npm run verify` there.
6. Edit the Markdown pages directly; run `node scripts/validate-content.mjs` before committing.
   Keep each page's `fields:` list in step with its frontmatter keys.

## Current state (2026-10-14)
Bundle 0.5.1 · 627 files · 577 live · 1 program. See app HANDOFF §1 for quality caveats.
