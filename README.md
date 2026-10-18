# lift-kb — LIFT Knowledge Base

Structured, longevity-first training content for the LIFT app: exercises,
programs, and (later) nutrition guidance. The app fetches this content as
versioned JSON bundles — **content only, never user data**.

## License

- **Prose (all Markdown/JSON text):** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — see LICENSE.md.
- **Media (images/video):** CC0 (public domain). Every asset is AI-generated
  original; `media/` records the generating service, model, prompt, and license
  check per asset.

## How it works

1. Content lives here as validated **Markdown pages** under `content/` — one page
   per exercise or program, YAML frontmatter for the structured fields plus fixed
   prose sections. Markdown is the only source of truth.
2. CI validates every file against `schemas/`, then builds
   `dist/kb-bundle-<version>.json` (+ `.sha256`) and uploads it as a
   **GitHub Release asset**.
3. `channel.json` tells the app what's current:
   `{ latest, minAppVersion, schemaVersion, sha256, revoked[] }`.
   The app fetches `channel.json`, downloads the bundle, verifies the sha256
   (expo-crypto), schema-validates, then atomically swaps its snapshot.
   Rollback = point `latest` back; `revoked[]` lists pulled versions.
4. The app ships with an in-binary snapshot so it works fully offline;
   updates apply on app open.

## Rules (enforced by CI + review)

- **Exercise IDs are permanent.** Never rename an ID. Deprecate with
  `"deprecated": true` + `"replacedBy": "<new-id>"`.
- **Longevity lens:** every exercise carries `longevityNotes` — why this
  movement matters for healthspan, trained sub-maximally. Rewrite, simplify,
  and filter everything through it.
- **Coach review is the merge gate.** AI-generated media and prose must be
  reviewed by a qualified coach before merge — anatomy errors are a safety
  liability.
- **No expert names** in content or metadata. Cite publications, not people.

## Repo layout

```
content/exercises/  one Markdown page per exercise (id = filename)
content/programs/   multi-week training blocks (progression + deloads)
content/README.md   hand-maintained index of every page
schemas/       JSON Schemas CI validates against
scripts/       build-bundle.mjs — emits dist/kb-bundle-<v>.json
               validate-content.mjs / lint-content.mjs / test-md-content.mjs
media/         CC0 asset manifest + naming conventions (assets via release)
channel.json   release channel descriptor (CI fills sha256)
kb-version.json  current bundle version + schemaVersion
```

## For AI agents / recovery

See `CLAUDE.md` here and, in the app repo (`rattymcfarty/lift-app`), `CLAUDE.md`,
`docs/ops/HANDOFF.md` and `docs/ops/RECOVERY.md`.

## Contributing

1. Add or edit a Markdown page under `content/exercises/` or `content/programs/`,
   and add it to `content/README.md`.
2. `node scripts/validate-content.mjs`, `node scripts/lint-content.mjs` and
   `node scripts/test-md-content.mjs`, then `node scripts/build-bundle.mjs`.
3. Open a PR — CI validates schemas and builds the bundle. Coach review
   required before merge.
