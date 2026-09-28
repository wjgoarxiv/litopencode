# Place diagrams in PowerPoint and Word

Choose the final page or slide ratio before drawing. Keep text live, preserve safe margins, and leave room for the document's own title, caption, and surrounding prose.

## Canvas and margins

| Destination | Canvas ratio | Diagram inset |
| --- | ---: | ---: |
| PowerPoint widescreen | 16:9, 1280 × 720 | 5% on each edge |
| PowerPoint standard | 4:3, 960 × 720 | 5% on each edge |
| Word inline | 16:10, 960 × 600 | 40 px |
| Word landscape/wide | 16:9, 1200 × 675 | 4% on each edge |

Keep titles and key labels inside the inset. Create a separate detail view instead of reducing type for dense content.

## Theme and image size

- Light is the default for Word, print, and shared slide decks.
- Use a dark diagram only when the presentation page also uses a dark canvas.
- Use the full-color variant when the figure needs its own title and legend. Avoid repeating a caption already present in the document.
- Use a 3× PNG for raster placement. For a 1280 × 720 source this produces a 3840 × 2160 image. Check transparency, Korean glyphs, and margins after placement.
- Prefer the Office-safe SVG when the recipient needs vector scaling. Keep the HTML or SVG source beside the document for future editing.

## Word and PowerPoint review

Provide a short figure title and description as document text. Use the surrounding caption field for numbering and cross-references. Set picture alt text to match the SVG's accessible title and description. Inspect the result at presentation size and at 100% page scale; verify that text, colors, and margins survive any requested PDF export.

The skill exports diagram assets; it does not generate DOCX or PPTX files or certify an Office renderer. If a final Word or PowerPoint artifact is requested, use the user's authorized document workflow and inspect the actual inserted figure. State any unsupported application or font behavior plainly.
