# Vendored sources notice

`vendor/` now holds one exact upstream payload: `vendor/handoff/`, the Handoff contract and template that
`skills/lit-handoff` adapts. Its provenance is `vendor/provenance/022_handoff.md` and its licence is
`vendor/licenses/022_handoff-MIT.txt`.

The scientific-visualization payload that used to sit here left LitOpenCode together with the
`lit-scientific-visualization` skill. It now lives in the separate wjgoarxiv-skills collection, in the `figures`
family at `plugins/figures/vendor/scientific-visualization/`, under the same MIT licence. LitOpenCode keeps a
same-name `lit-scientific-visualization` pointer that says how to install it.
