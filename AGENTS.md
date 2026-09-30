# AGENTS.md — LitOpenCode

Family-wide rules live in the parent `../AGENTS.md`. Read that first if you
started here; an agent launched inside this directory does not see it automatically.

This file covers only what differs in this repository.

## What this is

LitOpenCode — the **OpenCode** port of the lit workflow family. npm package `@litfamily/litopencode` (executable/native ID `litopencode`).
TypeScript ESM, tests via `node --test`. Git root is this directory, branch `master`.

## Entry points

| Surface | Path |
|---|---|
| Activation and routing | `src/activation.ts`, `src/activation-routing.ts`, `src/activation-prompt-utils.ts` |
| Command and feature registries | `src/commands.ts`, `src/features.ts`, `src/skills.ts` |
| Installer asset handling | `src/cli/managed-skill-assets.ts` |
| Skills corpus | `skills/<id>/SKILL.md` |

## Verification

```bash
npm test                            # node --test; ~649 pass as of 2026-08-01
npm run typecheck
npm run build
npm run scan:legacy-tokens
npm run check:version
npm run check:pack-payload
npm run check:managed-skill-manifest
```

Do not pipe a suite through `| tail` — `$?` then reports tail's exit code, not the suite's,
and the failure detail is truncated away. Redirect to a file instead. Running several repos'
suites concurrently has produced phantom failures here that do not reproduce serially.

## Local conventions

- **Relative imports carry explicit `.ts` extensions** (`rewriteRelativeImportExtensions`).
  Preserve that — dropping the extension breaks the build, not just style.
- The `lit-plan` agent is **planning-only by design**: edit and bash are denied even in yolo
  mode. Never grant it write access to make a task easier.
- Some test filenames intentionally keep an older prefix (e.g.
  `test/comprehend-command.test.mjs` for the `lit-comprehend` skill). A SKILL contract's
  `verification:` list names that exact path, so the pair is internally consistent. Renaming
  means editing the contract; do not "fix" it casually.

## Do not touch

- `HANDOFF.md` in this directory is **deprecated**. The authoritative handoff is
  `../HANDOFF.md` at the family root.
- `vendor/` holds exact vendored sources; treat those corpus files as read-only authority rather
  than editing them to change behavior.

## Packaging

Publication is governed by `.npmignore` (its presence disables the `.gitignore` fallback).
`AGENTS.md` is listed there, so this file is tracked in git but never published — a bare
`npm pack --dry-run` did include it before that entry was added.

The active Ignition vector cover (docs/assets/cover.svg) and docs/release-checklist.md stay in Git and are excluded from npm. The WebP motion cover and its still frame ship because the package README references them. The static robot cover (docs/assets/cover.webp) no longer appears in either README, but it still ships and the pack guard still requires it. The SVG uses explicit geometric paths and outlined glyphs with no embedded raster or external font dependency. Obsolete cover.png and generate_cover.py have been archived outside this product; keep their npm exclusions and pack-guard negative controls so those files cannot re-enter the package.

README.md and README-Ko-KR.md are the GitHub pages and load assets by relative ./docs/... paths. The npm package pages are README-npm.md and README-npm-Ko-KR.md (a hyphen, because npm always packs root README.* files); tools/readme-for-npm.mjs copies them over the GitHub pages in prepack and restores them in postpack, and a publish with --ignore-scripts must run its apply and restore by hand (see docs/release-checklist.md). Every file referenced by the npm pages must ship in the package and use a version-pinned https://cdn.jsdelivr.net/npm/@litfamily/litopencode@<version>/... URL. The exact README asset allowlist in .npmignore includes the outlined ASCII display, badges, wordmark and clay mark, licensed Lucide icons and license, font license, family illustration, and Ignition poster/MP4/GIF. The four Jev snapshot WebP files, the eight dark and light on-screen pictures (install, doctor, ignition toast, planner permissions) and the promo film in English and Korean (animated preview, poster, MP4, a shared reduced-motion still, and the sources and Pretendard license under docs/assets/readme/promo-source/) are shown only by the GitHub pages, so they stay in Git and out of the package; the pack guard rejects them and does not require them. check-pack-payload.mjs requires the landing README targets and rejects unapproved presentation files. Keep the copyable ASCII in all four README pages and update tools/version-manifests.json when a pinned URL is added or removed. docs/release-checklist.md remains repository-only: the GitHub pages may link it, the npm pages must not. Runtime icons elsewhere remain supported. Keep README entry paths concise; detailed operational contracts live in docs/reference.md and docs/reference-Ko-KR.md and remain packaged. Preserve native runtime payloads and supported small icons. New documentation assets must resolve locally before committing.
