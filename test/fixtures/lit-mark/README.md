# Terminal-mark provenance

`ignition-b.json` is the current canonical fixture. It contains the exact standard
22×10, banner 44×20, and micro 16×5 text rows and per-cell colors selected on
2026-09-06. SHA-256 of the complete file:
`e7f3e2be168bedc5c15836d105ffed570f3bfd8745522502293de8718f503aec`.

The approved B study sampled the authored Ignition vector's filled primitives into
Unicode quadrants. The predominant non-background color in each cell is orange
`#FF6337`, lime `#D7F75B`, or ivory `#F2EFDF`; null denotes a space. The micro symbol
uses eleven active columns inside its sixteen-column envelope. Trailing spaces and
the banner's last blank row belong to the envelope.

`src/lit-mark.ts` independently enrolls this data as text arrays and compact color
maps (`O` orange, `L` lime, `I` ivory, `.` space). Runtime imports never depend on this
fixture, the family workspace, or another product. The regression test pins the
fixture and checks every glyph and cell color against runtime output, including
lockups and uncolored rows. Changes require updating the reviewed geometry and
its provenance together; do not regenerate a new fixture from runtime output.

`round6.json` and `litmark6.mjs` remain unchanged historical references for the
former plume and extruded design. They do not define the current mark and are not
invoked by the current tests. Their historical generator writes a sheet into its
working directory if explicitly executed; it is not a production build step.

These source-only fixtures are excluded from npm. The production module is emitted
under `dist/` by the repository's existing release build.
