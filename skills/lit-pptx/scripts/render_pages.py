#!/usr/bin/env python3
"""render_pages.py - render a .pptx to a PDF and PNG pages so a person (or the model) can look at them.

LibreOffice (soffice) converts the deck to PDF in a private profile directory, so parallel runs
never share a lock. LibreOffice ignores the font parts a deck embeds, so the plain font files in
`ppt/fonts/*.fntdata` (what embed_fonts.py writes) are copied into that profile's font folder
first: the pages then show the faces PowerPoint shows, JetBrains Mono and Pretendard included,
even where the fonts are not installed. `pdftoppm` (poppler) rasterises the PDF when it is on
PATH; without it the PDF is the result. Without soffice nothing can be rendered: the script
prints SKIP with the reason and exits 0, and the caller must say the visual pass did not happen.

Usage:
    python3 scripts/render_pages.py <deck.pptx> --out-dir DIR [--pages N] [--dpi 110] [--json]

Writes DIR/<stem>.pdf and DIR/page-01.png ... Exit 1 on a failed conversion.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path


def profile_fonts(source: Path, profile: Path) -> list[Path]:
    """Copy the plain font files a .pptx embeds (ppt/fonts/*.fntdata) into the profile's font folder."""
    placed = []
    try:
        with zipfile.ZipFile(source) as package:
            for name in package.namelist():
                if not (name.startswith("ppt/fonts/") and name.endswith(".fntdata")):
                    continue
                data = package.read(name)
                # Only a TrueType or OpenType file; an obfuscated or EOT part is left to the renderer.
                kind = ".otf" if data[:4] == b"OTTO" else ".ttf" if data[:4] in (b"\x00\x01\x00\x00", b"true") else None
                if not kind:
                    continue
                target = profile / "user" / "fonts" / (Path(name).stem + kind)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
                placed.append(target)
    except zipfile.BadZipFile:
        return []
    return placed


def to_pdf(source: Path, out_dir: Path) -> tuple[Path | None, str]:
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        return None, "LibreOffice (soffice) is not on PATH"
    with tempfile.TemporaryDirectory(prefix="litopencode-soffice-") as profile:
        profile_fonts(source, Path(profile))
        result = subprocess.run(
            [soffice, f"-env:UserInstallation={Path(profile).as_uri()}", "--headless", "--convert-to", "pdf",
             "--outdir", str(out_dir), str(source)],
            capture_output=True, text=True, timeout=300,
        )
    pdf = out_dir / f"{source.stem}.pdf"
    if result.returncode != 0 or not pdf.exists():
        raise RuntimeError(f"soffice conversion failed: {(result.stderr or result.stdout).strip()[-400:]}")
    return pdf, "converted with soffice"


def rasterise(pdf: Path, out_dir: Path, pages: int, dpi: int) -> list[Path]:
    pdftoppm = shutil.which("pdftoppm")
    if not pdftoppm:
        return []
    subprocess.run([pdftoppm, "-png", "-r", str(dpi), "-l", str(pages), str(pdf), str(out_dir / "page")],
                   capture_output=True, text=True, timeout=300, check=True)
    written = []
    for png in sorted(out_dir.glob("page-*.png")):
        # pdftoppm pads the page number to the page count's width; page-01.png is the stable name.
        number = int(png.stem.split("-")[1])
        target = out_dir / f"page-{number:02d}.png"
        if png != target:
            png.replace(target)
        written.append(target)
    return written


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Render a deck to PDF and PNG pages.")
    parser.add_argument("input", type=Path)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--pages", type=int, default=12)
    parser.add_argument("--dpi", type=int, default=110)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    source = args.input.expanduser().resolve()
    out_dir = args.out_dir.expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        pdf, how = to_pdf(source, out_dir)
        pngs = rasterise(pdf, out_dir, args.pages, args.dpi) if pdf else []
    except (RuntimeError, subprocess.SubprocessError) as error:
        report = {"status": "fail", "input": str(source), "detail": str(error), "pages": []}
        print(json.dumps(report, ensure_ascii=False) if args.json else f"FAIL  {error}")
        return 1
    status = "rendered" if pdf else "skipped"
    detail = how if pngs or not pdf else f"{how}; pdftoppm is not on PATH, so only the PDF was written"
    report = {"status": status, "input": str(source), "detail": detail, "pdf": str(pdf) if pdf else None, "pages": [str(p) for p in pngs]}
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    elif pdf:
        print(f"PASS  rendered {len(pngs)} page(s) -> {out_dir}" if pngs else f"PASS  {detail}")
    else:
        print(f"SKIP  {how}; visual pages were not rendered")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
