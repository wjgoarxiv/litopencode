# README decoration patterns

Use decoration to help a reader find verified information. Keep the README's purpose,
working instructions, and source links understandable when every image and HTML block
is hidden. Decorations never establish a release, security, compatibility, quality, or
popularity claim.

## Inspection notes

Inspected on 2026-09-21. GitHub's displayed star counts below are selection-time snapshots,
not durable project facts; re-check them before any later research summary. No wording,
logos, or image assets from these repositories are reused here.

| Repository | Stars observed | README structure observed |
| --- | ---: | --- |
| [fastapi/fastapi](https://github.com/fastapi/fastapi) | 102.5k | A centered logo and short descriptor precede a compact row of linked workflow, coverage, and package badges. Sponsor marks are grouped by tier. Optional code variants and command detail use `<details>` blocks. Emoji appear selectively in prose and examples; section headings remain descriptive. |
| [vercel/next.js](https://github.com/vercel/next.js) | 142.2k | The opening stays text-led and links directly to learning, documentation, community, and a maintained showcase. Major topics use a simple heading hierarchy. |
| [astral-sh/uv](https://github.com/astral-sh/uv) | 90.0k | A small linked badge row and one-line purpose lead into a centered light/dark `<picture>` with a caption. Feature highlights are concise and scannable. |
| [ollama/ollama](https://github.com/ollama/ollama) | 181.3k | A centered linked logo leads into a short purpose statement. Usage is divided by reader task, then integrations are grouped by category. |
| [pytorch/pytorch](https://github.com/pytorch/pytorch) | 103.1k | The logo switches for light and dark themes. A linked table of contents supports a long README, and a two-column Markdown table compares components with their roles. |

Star figures were read from each repository page on the inspection date. They change and
must never be copied into project copy, badges, or generated claims as if they were stable.

## Apply the patterns

### Emoji section headers and section iconography

Treat an emoji as a small scan cue, not as the section name or a status indicator. The
inspected examples favor ordinary, descriptive headings and use emoji sparingly in nearby
copy. If the project's voice benefits from an icon, pair one recognizable glyph with a
clear heading, use the same meaning consistently, and leave the heading useful when the
glyph is missing or rendered monochrome. Do not use icons to imply a check, popularity,
security, or release state that repository evidence does not support.

### Centered hero and badge/logo row

Choose one hero arrangement: a centered project mark, a concise purpose line, and—only
when they help a reader act—a compact row of linked marks. The inspected README layouts
show both a logo-first arrangement and a short badge row near the title. Preserve the
project's actual logo and license. Each badge image and its link target must resolve to
the current repository's real endpoint or a verified project endpoint. Bind owner,
repository, default branch, package name, and workflow name from current local facts;
remove a badge if its image or target cannot be verified. Never carry another project's
badge URL forward.

Keep sponsor and partner marks in their own clearly labeled group. Use marks only where
the relationship is documented, and do not let placement imply endorsement or ownership.

### Collapsible `<details>` sections

The inspected README uses disclosure blocks for optional alternatives and extended
command notes. Keep the summary specific, make the primary path visible outside the
collapsed block, and put complete Markdown content between the opening and closing tags.
Use disclosures for secondary examples, long environment tables, or optional setup—not
for the project's purpose, required install steps, warnings, or essential features.

### Contributors, star history, and showcase embeds

The inspected Next.js README links to its maintained showcase instead of embedding a
third-party showcase widget; the other inspected projects also keep their core README
usable without contributor or star-history widgets. Use a direct repository graph or
maintained project page as the default. An image embed is optional: check the image URL
and click target for this exact repository, add meaningful alt text, and retain a text
link below it. Remove stale or unreachable embeds instead of leaving a broken panel.

For contributor art, use the repository's own contributor destination and do not imply
that a remote image service is an authoritative contributor record. For star history,
label the chart as a historical visualization and check that both the chart and link
identify this repository. For showcase material, use maintained examples with permission
and current destinations; a locally tracked screenshot grid is a good fallback. None of
these embeds proves project activity, adoption, endorsement, or quality.

### Table-based feature grids

The inspected PyTorch README uses a simple Markdown table to compare named components and
their roles. Use a table when each row answers the same small set of questions, such as
feature, reader-visible behavior, and repository evidence. Keep cells short, link to
real source or documentation, and move long explanations into their own sections. Do
not use a table for paragraphs, mobile-critical instructions, or decorative alignment.

### Footer navigation

The inspected READMEs keep durable destinations—documentation, contribution guidance,
community/support, and license—easy to find near the end or near the opening. A compact
footer link row can repeat the few destinations readers need after a long feature section.
Use only anchors and files that exist in this repository, keep labels descriptive, and
avoid repeating a full table of contents in the footer.

### Plain-Markdown fallback

Some registry and package pages remove HTML or render only a subset of it. Keep the
project title, purpose, install command, feature descriptions, and navigation as ordinary
Markdown. Replace centered HTML with a Markdown title and short paragraph; replace a
disclosure with a visible subheading; replace a remote image with its text link and
meaningful alt text. The cover picture and badge row are enhancements. If the renderer
cannot show them, readers must still get the same verified facts and usable links.

## Facts and endpoint rule

The facts helper checks reference structure and safe paths only; it does not compare a
claim with source contents or prove a badge endpoint. Before assembly, inspect the actual
repository files and open every badge, logo, contributor, chart, and showcase destination
that will ship. Keep claim text accurate, use only verified endpoints for this repository,
and omit every decoration whose truth or destination remains uncertain.
