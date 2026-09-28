# Type craft for Korean and Latin in motion

## Fonts and who ships them

| Voice | Latin | Hangul | Source |
| --- | --- | --- | --- |
| display | Archivo, static instances at widths 75/100/125 x weights 400/700/900 | LitOpenCode Sans Regular/Bold | Archivo instanced at development time from the pinned variable font (OFL); Hangul pair reused by path from `../lit-pptx` |
| body | Archivo 400/700 | LitOpenCode Sans Regular/Bold | as above |
| machine | MesloLGS NF | LitOpenCode Sans | Meslo fetched at pre-warm with its Apache-2.0 notice, the Apache text and the Vera/Arev notices |
| pixel | VT323 | Galmuri9 (outline build) | VT323 bundled; Galmuri9 fetched at pre-warm with its OFL text, unmodified |
| chrome | Silkscreen Regular/Bold (labels only) | none | bundled |
| stroke | EMS Allure, Felix, Osmotron, Readability, Tech (single-stroke SVG) | none | bundled with the OFL 1.1 text and a CREDITS file |

Every glyph is drawn from its font's outline data, positioned with the font's own advances and
kerning pairs. The type kit reports each drawn element (bbox after the scene transform and the post
chain's shake/zoom, font file, size, cap height, weight, fill and per-script runs) so the gate can
check title-safe, contrast, tracking and Hangul rules without reading pixels.

## Hard rules (the gate enforces the measurable ones)

1. Per-glyph layout (MO-A-32). When a word is drawn in pieces (a karaoke split, a per-letter
   reveal) piece *i* starts at the glyph position from the whole run's layout. Measuring the prefix
   substring instead drops the kerning pair between the two pieces.
2. Hangul is never condensed, stretched or faux-bolded (MO-A-33). Weight steps only between the two
   static files of the lit-pptx pair, 400 and 700. Width animation is Latin-only.
3. No Latin-style tracking or width motion on a Hangul script run, even inside a mixed line
   (MO-FT-04). Script runs split at the script boundary; digits, spaces and punctuation join the
   adjacent run, falling back to the run on their left between two scripts (so "2026년" is one Hangul
   run and "LIT팀" is "LIT" plus "팀").
4. Line breaks and reveal steps fall only between 어절 (MO-A-13, MO-FT-05).
5. No outlined or haloed type, ever (MO-A-35). Legibility comes from contrast and placement.
6. Typographic punctuation (MO-A-34): straight quotes and `...` in the brief become curly quotes and
   an ellipsis; a typed-input voice may switch back.
7. Tracking (MO-C-25, provisional): display type may tighten to -0.04em and no further; machine and
   body voices stay at 0 or looser.
8. Line height (MO-C-26): a block showing two or more lines at once holds at least 1.5 (Latin) or 1.6
   (Hangul), and at least 1.4 at three or more lines.
9. Measure (MO-C-27): a Latin paragraph card runs 60-75 characters per line; a Korean paragraph card
   outside 30-45 characters is an advisory note, not a failure.
10. Contrast (MO-C-06): body type at least 4.5:1, large type (32 px, or 25 px at weight 700) at least
    3:1, measured on the rendered frame under the glyph mask against its surroundings; a gradient fill
    uses its darkest and lightest percentiles.
11. Title-safe (MO-C-04): every glyph bbox inside 96 px left/right and 54 px top/bottom. Non-glyph
    elements stay inside the 95% action-safe box (MO-C-05, provisional).

## Guidance (craft defaults, not gate rules)

- Held Hangul body copy at or under about 32 px cap height uses Regular; large kinetic Hangul slams
  use Bold so thin strokes survive motion blur.
- Galmuri9 renders crisp at multiples of its 9 px grid and at least 45 px on screen; below that use
  a Latin pixel voice or plain body type.
- Keep Galmuri and VT323 on separate lines of a readout; they are never mixed cell for cell.
- Annotations sit beside large display type, not stacked under it; one idea per shot.
- The reading floor sets the minimum. A shot that must be read slowly gets more beats, not a smaller
  font.
