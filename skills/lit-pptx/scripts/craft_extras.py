"""Measured OOXML craft checks for the LitOpenCode slide QA gate."""

from __future__ import annotations

import colorsys
import json
import re
from pathlib import Path

from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE
from pptx.enum.text import PP_ALIGN

T = json.loads(Path(__file__).with_name("craft-thresholds.json").read_text())
EMU = 914400
NUMERIC = re.compile(r"^[\d\s,.%+\-±()$€£¥₩▲▼]+$")
HANGUL = re.compile(r"[가-힣]")
EMOJI = re.compile(r"[\U0001F000-\U0001FAFF\u2600-\u27BF]")


def _box(shape):
    return tuple(getattr(shape, key) / EMU for key in ("left", "top", "width", "height"))


def _gap(a, b):
    return max(0, max(a[0], b[0]) - min(a[0] + a[2], b[0] + b[2]),
               max(a[1], b[1]) - min(a[1] + a[3], b[1] + b[3]))


def _contains(outer, inner):
    return outer[0] <= inner[0] and outer[1] <= inner[1] and outer[0] + outer[2] >= inner[0] + inner[2] and outer[1] + outer[3] >= inner[1] + inner[3]


def _fill(shape):
    try:
        return tuple(shape.fill.fore_color.rgb) if shape.fill.type is not None else None
    except (AttributeError, TypeError):
        return None


def _hue(rgb):
    if rgb is None:
        return None
    hue, saturation, lightness = colorsys.rgb_to_hls(*(channel / 255 for channel in rgb))
    if saturation < T["accentSaturationMin"] or not T["accentLightnessMin"] <= lightness <= T["accentLightnessMax"]:
        return None
    return hue * 360


def _family_count(hues):
    families = []
    for hue in hues:
        if not any(min(abs(hue - other), 360 - abs(hue - other)) <= T["accentHueBucketDegrees"] for other in families):
            families.append(hue)
    return len(families)


def _text_size(shape):
    if not getattr(shape, "has_text_frame", False):
        return 0
    return max((run.font.size.pt for paragraph in shape.text_frame.paragraphs for run in paragraph.runs if run.font.size), default=0)


def _display(slide):
    text = [shape for shape in slide.shapes if getattr(shape, "has_text_frame", False) and shape.text.strip()]
    visual = [shape for shape in slide.shapes if getattr(shape, "has_table", False) or getattr(shape, "has_chart", False)]
    return bool(text) and max(map(_text_size, text)) >= T["displayPt"] and len(text) <= 2 and not visual


def _numeric(text):
    stripped = re.sub(r"[\s,.%+\-±()$€£¥₩▲▼]", "", text.strip())
    return bool(stripped) and stripped.isdigit()


def _radius(shape):
    try:
        return float(shape.adjustments[0]) * min(shape.width, shape.height) / EMU
    except (AttributeError, IndexError, TypeError, ValueError):
        return None


def _vertical_gaps(top, bottom, boxes):
    cursor = top
    gaps = []
    for _, y, _, height in sorted(boxes, key=lambda box: box[1]):
        gaps.append(max(0, y - cursor))
        cursor = max(cursor, y + height)
    gaps.append(max(0, bottom - cursor))
    return gaps


def analyse(path):
    deck = Presentation(str(path))
    canvas = deck.slide_width * deck.slide_height
    findings = []

    def add(rule, severity, slide, value, threshold, tier="measured", shape=None):
        findings.append({"rule": rule, "severity": severity, "tier": tier, "slide": slide,
                         "shape": shape, "value": value, "threshold": threshold})

    for slide_no, slide in enumerate(deck.slides, 1):
        shapes = [shape for shape in slide.shapes if isinstance(shape.width, int) and isinstance(shape.height, int)]
        display = _display(slide)
        hues = []
        for index, shape in enumerate(shapes, 1):
            if shape.width * shape.height >= T["fullBleedFraction"] * canvas:
                continue
            hue = _hue(_fill(shape))
            if hue is not None:
                hues.append(hue)
            if shape._element.xpath('.//a:glow'):
                add("OF-107", "HIGH", slide_no, "glow", "none", shape=index)
            if shape._element.xpath('.//a:rPr/a:gradFill'):
                add("OF-106", "HIGH", slide_no, "gradient text", "none", shape=index)
            for bullet in shape._element.xpath('.//a:pPr/a:buChar'):
                char = bullet.get("char", "")
                if EMOJI.search(char):
                    add("OF-108", "HIGH", slide_no, char, "no emoji bullet", shape=index)

            if getattr(shape, "has_text_frame", False) and shape.text.strip():
                size = _text_size(shape)
                if not T["captionPt"] < size < T["displayPt"]:
                    continue
                chars = len(re.sub(r"\s", "", shape.text))
                if not chars:
                    continue
                usable = max(1, shape.width - shape.text_frame.margin_left - shape.text_frame.margin_right)
                estimated_width = sum((0.98 if HANGUL.match(char) else 0.56) * size for char in shape.text) / 72
                lines = max(shape.text.count("\n") + 1, round(estimated_width / max(usable / EMU, .01) + .5))
                if lines < 2:
                    continue
                measure = chars / lines
                cjk = len(HANGUL.findall(shape.text)) / chars >= T["cjkMajority"]
                ceiling = T["bodyCjkCharsMax"] if cjk else T["bodyLatinCharsMax"]
                if measure > ceiling:
                    add("OF-102", "HIGH", slide_no, round(measure, 1), ceiling, "derived", index)
                elif lines >= T["bodyNarrowLines"] and measure < T["bodyNarrowChars"]:
                    add("OF-102", "MEDIUM", slide_no, round(measure, 1), T["bodyNarrowChars"], "derived", index)

            if getattr(shape, "has_table", False):
                table = shape.table
                for col in range(len(table.columns)):
                    cells = [table.cell(row, col) for row in range(1, len(table.rows))]
                    if len(cells) < 2 or sum(_numeric(cell.text) for cell in cells) / len(cells) < T["numericMajority"]:
                        continue
                    for row, cell in enumerate(cells, 2):
                        if not _numeric(cell.text):
                            continue
                        for paragraph in cell.text_frame.paragraphs:
                            if not paragraph.text.strip():
                                continue
                            if paragraph.alignment is None:
                                add("OF-103", "MEDIUM", slide_no, {"row": row, "col": col + 1, "alignment": None}, "right", "derived", index)
                            elif paragraph.alignment != PP_ALIGN.RIGHT:
                                add("OF-103", "HIGH", slide_no, {"row": row, "col": col + 1, "alignment": str(paragraph.alignment)}, "right", shape=index)

        count = _family_count(hues)
        medium = T["displayAccentMedium"] if display else T["contentAccentMedium"]
        high = T["displayAccentHigh"] if display else T["contentAccentHigh"]
        if count >= medium:
            add("OF-101", "HIGH" if count >= high else "MEDIUM", slide_no, count, {"medium": medium, "high": high})

        rounds = [(index, shape, _box(shape), _radius(shape)) for index, shape in enumerate(shapes, 1) if shape.shape_type == MSO_SHAPE_TYPE.AUTO_SHAPE and "ROUNDED_RECTANGLE" in str(shape.auto_shape_type)]
        for inner_index, inner, ibox, iradius in rounds:
            for outer_index, outer, obox, oradius in rounds:
                if inner is outer or iradius is None or oradius is None or not _contains(obox, ibox):
                    continue
                insets = [ibox[0] - obox[0], obox[0] + obox[2] - ibox[0] - ibox[2], ibox[1] - obox[1], obox[1] + obox[3] - ibox[1] - ibox[3]]
                if max(insets) - min(insets) > T["radiusInsetToleranceIn"] or oradius <= T["outerRadiusMinIn"]:
                    continue
                expected = max(0, oradius - sum(insets) / len(insets))
                if abs(iradius - expected) > T["radiusDifferenceToleranceIn"]:
                    add("OF-104", "HIGH", slide_no, round(iradius, 3), round(expected, 3), shape=inner_index)

        panels = [(shape, _box(shape)) for shape in shapes if _fill(shape) is not None and .2 < shape.width * shape.height / canvas < T["fullBleedFraction"]]
        groups = []
        for panel, pbox in panels:
            members = [_box(item) for item in shapes if item is not panel and getattr(item, "has_text_frame", False) and item.text.strip() and _contains(pbox, _box(item))]
            if len(members) >= 2:
                groups.append((pbox, members))
        if len(groups) >= 2:
            intra = max((min(_gap(a, b) for i, a in enumerate(members) for b in members[i + 1:]) for _, members in groups), default=0)
            inter = min((_gap(a, b) for i, (a, _) in enumerate(groups) for b, _ in groups[i + 1:]), default=0)
            if intra > 0 and inter < T["groupRatioMin"] * intra:
                add("OF-105", "MEDIUM", slide_no, round(inter / intra, 2), T["groupRatioMin"])

        if not display:
            title = max((shape for shape in shapes if getattr(shape, "has_text_frame", False) and shape.text.strip() and _text_size(shape) >= T["displayPt"]), key=_text_size, default=None)
            top = (title.top + title.height) / EMU + .1 if title else .8
            bottom = deck.slide_height / EMU - .55
            content = [_box(shape) for shape in shapes if shape is not title and (getattr(shape, "has_table", False) or getattr(shape, "has_chart", False) or shape.shape_type == MSO_SHAPE_TYPE.PICTURE or (getattr(shape, "has_text_frame", False) and shape.text.strip() and _text_size(shape) > T["captionPt"])) and top <= shape.top / EMU < bottom]
            if content and bottom > top:
                gaps = _vertical_gaps(top, bottom, content)
                fraction = max(gaps) / (bottom - top)
                if fraction >= T["emptyBandMedium"]:
                    add("OF-109", "HIGH" if fraction > T["emptyBandHigh"] else "MEDIUM", slide_no, round(fraction, 3), {"medium": T["emptyBandMedium"], "high": T["emptyBandHigh"]})

        card_gaps = []
        for index, card in enumerate(shapes, 1):
            if _fill(card) is None or card.width * card.height / canvas >= T["fullBleedFraction"]:
                continue
            x, y, width, height = _box(card)
            if width <= 0 or height <= 0:
                continue
            frame = getattr(card, "text_frame", None) if getattr(card, "has_text_frame", False) else None
            top = y + (frame.margin_top / EMU if frame else 0)
            bottom = y + height - (frame.margin_bottom / EMU if frame else 0)
            inner = [(item, _box(item)) for item in shapes if item is not card and _contains((x, y, width, height), _box(item)) and (getattr(item, "has_table", False) or getattr(item, "has_chart", False) or item.shape_type == MSO_SHAPE_TYPE.PICTURE or getattr(item, "has_text_frame", False) and item.text.strip())]
            if not inner or bottom <= top:
                continue
            text_items = [item for item, _ in inner if getattr(item, "has_text_frame", False) and item.text.strip()]
            visuals = [item for item, _ in inner if getattr(item, "has_table", False) or getattr(item, "has_chart", False) or item.shape_type == MSO_SHAPE_TYPE.PICTURE]
            if text_items and len(text_items) <= 2 and not visuals and max(map(_text_size, text_items)) >= T["displayPt"]:
                continue
            gaps = _vertical_gaps(top, bottom, [box for _, box in inner])
            card_gaps.append({"index": index, "top": y, "height": height, "head": max(gaps[:-1], default=0) / (bottom - top), "tail": gaps[-1] / (bottom - top)})
        for card in card_gaps:
            row = [peer for peer in card_gaps if abs(peer["top"] - card["top"]) <= T["equalRowToleranceIn"] and abs(peer["height"] - card["height"]) <= T["equalRowToleranceIn"]]
            trailing = min(peer["tail"] for peer in row)
            fraction = max(card["head"], trailing)
            if fraction >= T["emptyBandMedium"]:
                add("OF-109", "HIGH" if fraction > T["emptyBandHigh"] else "MEDIUM", slide_no, round(fraction, 3), {"medium": T["emptyBandMedium"], "high": T["emptyBandHigh"]}, shape=card["index"])

    return {"pass": not any(item["severity"] == "HIGH" for item in findings), "findings": findings}
