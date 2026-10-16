# CLAUDE.md — lift-kb

Content repository for **LIFT** (the app lives in `rattymcfarty/lift-app`).
**Start with the app repo's `CLAUDE.md` and `docs/ops/HANDOFF.md`** — they hold the
project-wide rules, state and recovery runbook. This file is the KB-specific part.

## What is here
- `exercises/<id>.json` — one exercise per file (`id` == filename). Schema:
  `schemas/exercise.schema.json` (draft-07, `additionalProperties: false`).
- `programs/*.json` — multi-week programs (`schemas/program.schema.json`).
- `content/` — **generated** Markdown pages for browsing (one per exercise and program,
  plus an index). Built from the JSON by `node scripts/build-markdown.mjs`; never edit by
  hand. JSON stays the source of truth.
- `kb-version.json` — current bundle version; `channel.json` — release channel
  (`latest`, `sha256`, …) which **must match a fresh build** (CI fails otherwise).
- `scripts/build-bundle.mjs` — validates ids/filenames and emits
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
   (`npx -y ajv-cli validate -s schemas/exercise.schema.json -d 'exercises/*.json'`),
   commit, push — then refresh the app snapshot:
   `node ~/lift/lift-app/scripts/sync-kb-snapshot.mjs ~/lift/lift-kb` in `lift-app`
   and run `npm run verify` there.
6. After any JSON change run `node scripts/build-markdown.mjs` and commit `content/` too
   (`--check` exits 1 if it is stale).
7. Preserve each file's existing JSON formatting (indented vs compact) — rewriting
   untouched files creates giant noisy diffs.

## Current state (2026-10-14)
Bundle 0.5.1 · 627 files · 577 live · 1 program. See app HANDOFF §1 for quality caveats.
