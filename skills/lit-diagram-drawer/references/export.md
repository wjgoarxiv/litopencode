# Export a checked diagram

Export only after the HTML or SVG source passes its verifiers. Capture the diagram itself, not editor controls, an example gallery, or a browser frame. Write output into the project or another user-selected output folder, not into this installed skill's managed tree.

~~~sh
node scripts/export.mjs --input path/to/diagram.html --out path/to/exports --scale 2 --office-safe
~~~

PNG export requires an already-installed, identity-checked agent-browser at version 0.38.1 or newer, a verified Chrome for Testing 154 installation, the bundled Pretendard font with matching provenance and license, and the product's local humanizer detector. The exporter waits for fonts, checks the rendered SVG dimensions and viewport, and verifies the local font face. It does not install software. Run `node scripts/doctor.mjs` for a read-only capability report; add `--out DIR` to check write access at the selected export directory or its nearest existing parent. If a renderer is missing, the exporter prints setup commands for you to run yourself.

Before any browser-driver command or output-directory creation, the exporter bounds the source read and rejects non-regular or symlinked files, HTML comment markup, active elements (including SVG animation/discard), event handlers, refresh navigation, external href/src references, unsafe bases, and external or escaped CSS resources, including string-form `image-set()`, `image()`, and `src()` functions. Keep references self-contained: CSS may use same-document fragments, embedded WOFF2 data, or the packaged Pretendard font; href/src attributes may use same-document fragments. Remote and arbitrary local files are not loaded during capture.

The optional Office-safe SVG embeds the bundled font, preserves live text and the source viewBox, removes unsupported filters, and rejects active or external content, remote fonts, and unsafe CSS URLs. It is a portable SVG output, not proof that a particular version of Word or PowerPoint renders it identically. Do not claim outlined text unless the SVG contains paths instead of text nodes.

For tree-block-decomposition, use --registry only when a traceability sidecar was requested. The sidecar reflects declared block metadata in source order and rejects blank or duplicate ids, missing parents, multiple roots, and cycles. It never infers missing values.

On a missing renderer, font, or write capability, no partial export is written. Preserve the editable source and report the exact blocker; the printed setup commands are for the user to run. Record actual output paths and inspect the image at its intended size before calling it complete.
