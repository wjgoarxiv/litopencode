# Terminal mark and activation probes

The CLI uses the approved Ignition B interlocking symbol and a product-name column.
Installer, doctor, and help share the banner renderer; automatic updates reuse
the installer. Doctor keeps its interactive banner on stderr because stdout remains
JSON, including when `--json` is omitted. The five-stage install-plan frame remains around the mark.

In a source checkout, `src/lit-mark.ts` contains the standard (22×10), banner (44×20),
and micro (16×5) rows plus their per-cell color maps. `lockup(productName)` preserves
the native label column: six spaces after the mark envelope and a two-space gap
before the label. Passing `banner` or `micro` uses the same rule at that scale.
Labels can contain arbitrary printable text; control characters are removed.
The mark's exact source and pinned fixture are documented in
`test/fixtures/lit-mark/README.md`. The former round6 sheet and generator are retained
as historical references. Test fixtures and TypeScript sources are excluded from
the npm package; the compiled mark module ships in `dist/` without a sibling or
family-workspace dependency. Trailing padding and the banner's final blank row are
part of the canonical envelope. README code blocks omit only line-end padding.

`colorize(rows, { mode })` accepts `truecolor`, `256`, or `none`. The B symbol uses
flat orange `#FF6337`, lime `#D7F75B`, and ivory `#F2EFDF` at their canonical cells;
the ANSI 256 approximations are 203, 191, and 230. It sets no terminal background.
Canonical rows and their lockups retain the same glyphs with or without color, and
the product label stays uncolored. Unknown custom rows use ivory for block glyphs.
The optional legacy `shadow` hex argument remains validated for API compatibility
but does not recolor the symbol, which has no extrusion layer. Functional spinner,
progress, and success colors keep their own existing policy and values.

`NO_COLOR` and CI disable ANSI even when their environment values are empty;
non-TTY output and JSON also disable ANSI. A non-UTF-8 locale or `TERM=dumb` selects a plain `LIT` line.
Locale precedence is `LC_ALL`, `LC_CTYPE`, then `LANG`; an absent locale is conservative.

OpenCode's first `experimental.text.complete` for each session displays only the standard
mark rows. Each later completion displays only the micro rows; neither completion mark
repeats a discipline label, leaving the model's bold ignition line as the sole label.
The completion hook is the session-start surface because plugin initialization has no
session ID. Deleting a session clears both its first-completion
and discipline state; plugin disposal clears all state. A new root user turn resets the prior discipline,
and a trusted chat, command, or successful activation-tool result selects the current
one. Status and blocked tool results do not change the discipline. Unactivated turns use `lit-loop`.
Marks are fenced Markdown without ANSI because OpenCode renders completion text as
Markdown, including when its process owns a colored terminal.

The model must begin its reply with exactly one `🔥 **LIT IGNITED · <discipline>** 🔥` line. Prompts
require this explicitly. Activation messages use the plain `🔥 LIT IGNITED · <discipline> 🔥`
banner. On successful activation, the plugin also requests a six-second warning toast titled
`🔥 LIT IGNITED` with the five trimmed micro rows followed by that label when the environment
supports mark glyphs; otherwise it shows only the label. Toast messages never contain ANSI. A
missing or failing TUI client never blocks prompt injection. The completion hook adds the separate
harness mark and preserves the model's response, including a missing or malformed probe, so the
harness cannot manufacture evidence that the model obeyed the prompt.
