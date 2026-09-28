"""Source-only DOCX craft checks with explicit measurement tiers."""

from __future__ import annotations

import json
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

T = json.loads(Path(__file__).with_name("craft-thresholds.json").read_text())
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
HANGUL = re.compile(r"[가-힣]")


def _text(element):
    return "".join(node.text or "" for node in element.iter(W + "t"))


def _number(text):
    remaining = re.sub(r"[\s,.%+\-±()$€£¥₩▲▼]", "", text.strip())
    return bool(remaining) and remaining.isdigit()


def _attribute(element, name, fallback):
    value = element.get(W + name) if element is not None else None
    return float(value) if value is not None else fallback


def analyse(path):
    with zipfile.ZipFile(path) as archive:
        document = ET.fromstring(archive.read("word/document.xml"))
        styles = ET.fromstring(archive.read("word/styles.xml"))
    body = document.find(W + "body")
    section = body.find(W + "sectPr") if body is not None else None
    page = section.find(W + "pgSz") if section is not None else None
    margins = section.find(W + "pgMar") if section is not None else None
    width = _attribute(page, "w", T["fallbackPageWidthTwips"])
    left = _attribute(margins, "left", T["fallbackMarginTwips"])
    right = _attribute(margins, "right", T["fallbackMarginTwips"])
    usable_inches = max(0, width - left - right) / 1440
    normal = next((style for style in styles.findall(W + "style") if style.get(W + "styleId") == "Normal"), None)
    normal_size = normal.find(".//" + W + "sz") if normal is not None else None
    font_pt = _attribute(normal_size, "val", T["fallbackFontPt"] * 2) / 2
    findings = []

    if body is None:
        return findings
    for paragraph_no, paragraph in enumerate(body.findall(W + "p"), 1):
        text = _text(paragraph).strip()
        if len(text) < 40:
            continue
        letters = [char for char in text if not char.isspace()]
        cjk = bool(letters) and len(HANGUL.findall(text)) / len(letters) >= T["cjkMajority"]
        factor = T["cjkGlyphFactor"] if cjk else T["latinGlyphFactor"]
        ceiling = T["cjkMeasureMax"] if cjk else T["latinMeasureMax"]
        run_sizes = [float(node.get(W + "val")) / 2 for node in paragraph.findall(".//" + W + "sz") if node.get(W + "val")]
        size = max(run_sizes, default=font_pt)
        measure = usable_inches * 72 / max(1, size * factor)
        if measure > ceiling:
            findings.append({"rule": "OF-301", "severity": "MEDIUM", "tier": "derived", "where": f"paragraph {paragraph_no}", "value": round(measure, 1), "threshold": ceiling})

    for table_no, table in enumerate(body.iter(W + "tbl"), 1):
        rows = table.findall(W + "tr")
        if len(rows) < 3:
            continue
        data = [[cell for cell in row.findall(W + "tc")] for row in rows[1:]]
        columns = max(map(len, data), default=0)
        for column in range(columns):
            cells = [row[column] for row in data if len(row) > column]
            if len(cells) < 2 or sum(_number(_text(cell)) for cell in cells) / len(cells) < T["numericMajority"]:
                continue
            for row_no, cell in enumerate(cells, 2):
                if not _number(_text(cell)):
                    continue
                for paragraph in cell.findall(W + "p"):
                    if not _text(paragraph).strip():
                        continue
                    alignment = paragraph.find("./" + W + "pPr/" + W + "jc")
                    value = alignment.get(W + "val") if alignment is not None else None
                    if value != "right":
                        findings.append({"rule": "OF-302", "severity": "HIGH" if value else "MEDIUM", "tier": "measured" if value else "derived", "where": f"table {table_no} row {row_no} col {column + 1}", "value": value, "threshold": "right"})
    return findings
