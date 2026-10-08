"""Deck-wide output checks for the LitOpenCode slide QA gate (OF-110..OF-119).

craft_extras.py judges one slide at a time. These checks read the compiled deck as a whole:

  OF-110  a deck of eight or more slides mixes at least three title treatments, and every title
          is drawn the way its `title@<treatment>` name says
  OF-111  content slides vary their composition (title zone x body partition x dominant content)
  OF-112  the body is used: a slide over its density cap is advisory, a deck median over the
          limit fails
  OF-113  every slide that uses one treatment keeps that treatment's title frame (a bottom title
          keeps its bottom edge on the floor; its top follows its line count)
  OF-114  titles and the cover subtitle name a topic; they are not declarative sentences
  OF-115  no region stands empty beside a full one: a bottom title ends on the body floor, a side
          rail carries what belongs beside the title, a takeaway column runs as long as the visual
          next to it, a column of a two-column body holds no tall empty band beside a longer one, a
          title panel is as tall as its text, and no plate leaves the page above it open
  OF-116  (qa_deck.py --sibling) another tonality of the same source draws a different skeleton
          (two content slides once the deck has four)
  OF-117  no light figure card stands on a dark ground
  OF-118  a bold run-in label is followed by its separator ("요약: …", "Summary: …")
  OF-119  an agenda's title carries no count numeral beside it (its rows are numbered)

The treatment is read from the title frame's geometry and what is drawn with it. The name the
compiler writes is compared with that reading, never trusted alone. A deck the tonality compiler
did not build (no `title@` shape) is out of scope. On a legacy template (`title@legacy`) the
variety checks are advisory: whoever names a legacy template has asked for its single look.
Geometry is in points; every threshold lives in craft-thresholds.json (`output*` keys).
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path

from pptx.enum.shapes import MSO_SHAPE_TYPE
from pptx import Presentation

from layout_inventory import _measured_lines

T = json.loads(Path(__file__).with_name("craft-thresholds.json").read_text())
PT = 12700
TREATMENTS = ("top-rule", "top-plain-large", "side-rail", "band", "statement", "overlay", "kicker-numeral", "bottom-anchor")
ZONE = {"top-rule": "top", "top-plain-large": "top", "kicker-numeral": "top", "side-rail": "side", "band": "band",
        "overlay": "overlay", "bottom-anchor": "bottom", "statement": "none"}
# The widest four-column title and the earliest column-5 start over the four grids, per canvas width.
RAIL = {960: (288.0, 336.0), 720: (216.0, 252.0)}
SIDE_MARGIN = {960: {"airy": 60.0, "standard": 48.0, "dense": 36.0, "compact": 24.0},
               720: {"airy": 54.0, "standard": 42.0, "dense": 30.0, "compact": 24.0}}
STAMP = re.compile(r"\blit-pptx tonality=(\S+) density=(\d+) grid=(\w+) variance=(\d+)")
NUMERAL = re.compile(r"\d+(?:[.:/-]\d+)?\.?")


def _finding(rule, severity, slide, shape, value, hint):
    return {"rule": rule, "severity": severity, "tier": "measured", "slide": slide, "shape": shape,
            "value": value, "threshold": None, "hint": hint}


def _text(shape):
    if not getattr(shape, "has_text_frame", False):
        return ""
    return re.sub(r"\s+", " ", shape.text_frame.text).strip()


def _filled(shape):
    try:
        return shape.fill.type == 1
    except (AttributeError, TypeError, NotImplementedError):
        return False


def _touches_two_edges(x, y, w, h, width, height, tol=2.0):
    """A fill on two or more canvas edges (band, rail, colour field) is page furniture, not a card."""
    return sum([x <= tol, y <= tol, x + w >= width - tol, y + h >= height - tol]) >= 2


def _inside(item, box, tol=1.0):
    cx, cy = item["x"] + item["w"] / 2, item["y"] + item["h"] / 2
    return box["x"] - tol <= cx <= box["x"] + box["w"] + tol and box["y"] - tol <= cy <= box["y"] + box["h"] + tol


def _footer(item):
    return item["y"] >= T["outputFooterTopPt"]


def _items(slide, width, height):
    """Every drawn shape in points with its kind and its role: content, card or decoration."""
    items = []
    for shape in slide.shapes:
        if shape.left is None or shape.width is None or shape.name.startswith("lit-notice"):
            continue
        x, y, w, h = shape.left / PT, shape.top / PT, shape.width / PT, shape.height / PT
        if w + h <= 0:
            continue
        text = _text(shape)
        if shape.shape_type == MSO_SHAPE_TYPE.PICTURE:
            kind = "picture"
        elif getattr(shape, "has_table", False):
            kind = "table"
            h = max(h, sum(row.height for row in shape.table.rows) / PT)
        elif getattr(shape, "has_chart", False):
            kind = "chart"
        else:
            kind = "text" if text else "shape"
        sizes = [run.font.size.pt for paragraph in shape.text_frame.paragraphs for run in paragraph.runs
                 if run.text.strip() and run.font.size is not None] if text else []
        items.append({"shape": shape, "name": shape.name, "kind": kind, "x": x, "y": y, "w": w, "h": h, "text": text,
                      "sizes": sizes, "filled": kind == "shape" and _filled(shape)})
    for item in items:
        if item["kind"] != "shape":
            item["role"] = "content"
            continue
        holds = any(other["kind"] != "shape" and _inside(other, item) for other in items if other is not item)
        card = (item["filled"] and holds and not _touches_two_edges(item["x"], item["y"], item["w"], item["h"], width, height)
                and item["w"] >= 100 and item["h"] >= 40 and item["w"] * item["h"] < 0.5 * width * height)
        item["role"] = "card" if card else "decoration"
    return items


def treatment_of(title, items, width, height):
    """The treatment a title shows, tested in a fixed order; the first that fits wins."""
    tol, size_tol = T["outputGeometryTolPt"], T["outputSizeTolPt"]
    size = max(title["sizes"] or [0.0])
    bottom = title["y"] + title["h"]
    others = [item for item in items if item is not title]
    body = [item for item in others if not _footer(item) and item["role"] != "decoration"]

    def behind(item):
        return (item["x"] - tol <= title["x"] and title["x"] + title["w"] <= item["x"] + item["w"] + tol
                and item["y"] - tol <= title["y"] and bottom <= item["y"] + item["h"] + tol)

    if (any(item["kind"] == "picture" and item["w"] * item["h"] >= 0.8 * width * height for item in others)
            and title["y"] >= 300 - tol and any(item["kind"] == "shape" and item["filled"] and behind(item) for item in others)):
        return "overlay"
    if any(item["kind"] == "shape" and item["filled"] and item["y"] <= 2 + tol and 96 - tol <= item["h"] <= 120 + tol
           and item["w"] >= 0.9 * width and _inside(title, item, tol) for item in others):
        return "band"
    if (size >= 36 - size_tol and 220 - tol <= title["y"] + title["h"] / 2 <= 380 + tol
            and not any(item["kind"] in ("table", "chart", "picture") or item["role"] == "card" for item in body)
            and sum(1 for item in body if item["kind"] == "text") <= 1):
        return "statement"
    if title["y"] >= 360 - tol and all(item["y"] <= title["y"] + tol for item in body if item["kind"] == "text"):
        return "bottom-anchor"
    rail_width, column_five = RAIL.get(round(width), RAIL[960])
    beside = [item for item in body if item["x"] + item["w"] / 2 > title["x"] + title["w"]]
    # Criteria labels, takeaways and the source under the title stand in the rail and belong to it; only a
    # block that runs out of the rail into the body makes the title something else.
    if (title["w"] <= rail_width + tol and beside and min(item["x"] for item in beside) >= column_five - tol
            and not any(item["x"] < column_five - tol and item["y"] > bottom and item["x"] + item["w"] > column_five + tol for item in body)):
        return "side-rail"
    for item in others:
        if (item["kind"] == "text" and item["sizes"] and NUMERAL.fullmatch(item["text"]) and max(item["sizes"]) >= 44 - size_tol
                and item["x"] + item["w"] <= title["x"] + tol and item["y"] >= 30 - tol and item["y"] + item["h"] <= 114 + tol):
            return "kicker-numeral"
    if title["y"] <= 48 + tol:
        # A rule is a line under the title (wider than 16 pt and four times its height), never a list dot.
        rule = any(item["kind"] == "shape" and item["h"] <= 8 and item["w"] >= max(16, 4 * item["h"])
                   and bottom - tol <= item["y"] <= bottom + 24 and item["x"] < title["x"] + title["w"]
                   and item["x"] + item["w"] > title["x"] for item in others)
        if size >= 36 - size_tol and not rule:
            return "top-plain-large"
        if size <= 32 + size_tol and rule:
            return "top-rule"
    return "unclassified"


def _is_figure(item):
    """Text of 44 pt or more that is mostly digits reads as a number, not as text."""
    compact = re.sub(r"\s+", "", item["text"])
    digits = len(re.findall(r"\d", compact))
    return item["kind"] == "text" and bool(item["sizes"]) and max(item["sizes"]) >= 44 - T["outputSizeTolPt"] and digits / max(1, len(compact)) >= 0.5


def signature(title, treatment, items, width, height, margin):
    """(title zone, body partition, dominant content) of one slide.

    Body blocks group into columns by their horizontal extent: two blocks that overlap by half the
    narrower one share a column. A block wider than the wide-block share of the body (a takeaway
    under two columns) never merges columns.
    """
    zone = ZONE.get(treatment, "none")
    if treatment == "statement":
        return (zone, "one", "text")
    column_five = RAIL.get(round(width), RAIL[960])[1]
    body = []
    for item in items:
        if item is title or _footer(item) or item["role"] == "decoration":
            continue
        if treatment == "side-rail" and item["x"] + item["w"] <= column_five + T["outputGeometryTolPt"]:
            continue  # the rail is part of the title zone, not a column of the body
        if item["kind"] == "shape" and title is not None and _inside(title, item, 0):
            continue  # the panel the title stands on
        if treatment == "kicker-numeral" and item["kind"] == "text" and NUMERAL.fullmatch(item["text"]) and item["y"] + item["h"] <= 116:
            continue
        body.append(item)
    cards = [item for item in body if item["role"] == "card"]
    blocks = [item for item in body if not any(card is not item and _inside(item, card) for card in cards)]
    if any(item["kind"] == "picture" and item["w"] * item["h"] >= 0.8 * width * height for item in items):
        partition = "full-bleed"
    elif not blocks:
        partition = "one"
    else:
        narrow = [item for item in blocks if item["w"] < T["outputWideBlockShare"] * (width - 2 * margin)] or blocks
        columns = []
        for item in sorted(narrow, key=lambda entry: entry["x"]):
            hits = [column for column in columns
                    if min(column["r"], item["x"] + item["w"]) - max(column["l"], item["x"]) >= 0.5 * min(column["r"] - column["l"], item["w"])]
            if hits:
                keep = hits[0]
                for other in hits[1:]:
                    keep["l"], keep["r"] = min(keep["l"], other["l"]), max(keep["r"], other["r"])
                    keep["items"] += other["items"]
                    columns.remove(other)
                keep["l"], keep["r"] = min(keep["l"], item["x"]), max(keep["r"], item["x"] + item["w"])
                keep["items"].append(item)
            else:
                columns.append({"l": item["x"], "r": item["x"] + item["w"], "items": [item]})
        column_of = {id(entry): number for number, column in enumerate(columns) for entry in column["items"]}
        rows = []
        for item in sorted(narrow, key=lambda entry: entry["y"]):
            if rows and item["y"] < rows[-1]["bottom"] - 2:
                rows[-1]["bottom"] = max(rows[-1]["bottom"], item["y"] + item["h"])
                rows[-1]["items"].append(item)
            else:
                rows.append({"bottom": item["y"] + item["h"], "items": [item]})
        shared_rows = sum(1 for row in rows if len({column_of[id(entry)] for entry in row["items"]}) >= 2)
        count = len(columns)
        if count >= 4 or (count >= 2 and shared_rows >= 2):
            partition = "grid"
        elif count == 3:
            partition = "three"
        elif count == 2:
            first, second = (column["r"] - column["l"] for column in columns)
            partition = "two-even" if min(first, second) / max(first, second) >= T["outputEvenColumns"] else "two-asym"
        else:
            partition = "one"
    area = {}
    kinds = {"picture": "image", "table": "table", "chart": "chart"}
    for item in blocks:
        if item["kind"] in kinds:
            key = kinds[item["kind"]]
        elif item["kind"] == "text":
            key = "number" if _is_figure(item) else "text"
        else:
            continue
        area[key] = area.get(key, 0.0) + item["w"] * item["h"]
    for card in cards:
        held = [item for item in body if item is not card and _inside(item, card)]
        key = "number" if any(_is_figure(item) for item in held) else "text"
        area[key] = area.get(key, 0.0) + card["w"] * card["h"]
    return (zone, partition, max(area, key=area.get) if area else "text")


def empty_band(title, items, top_margin=36.0):
    """Share of the body left empty under its lowest block, from the title's foot (or the top margin
    when the title sits low) to the body floor; decoration, footer and notice are not counted."""
    floor = T["outputBandFloorPt"]
    top = title["y"] + title["h"] if title is not None and title["y"] + title["h"] < floor * 0.6 else top_margin
    if floor - top < 10:
        return None
    ink = [item for item in items if item["role"] != "decoration" and not _footer(item) and item["y"] < floor and item["y"] + item["h"] > top]
    lowest = max((min(floor, item["y"] + item["h"]) for item in ink), default=top)
    return max(0.0, (floor - lowest) / (floor - top))


def _role(family):
    for kind in ("cover", "section", "closing"):
        if family == kind or family.startswith(kind + "-"):
            return kind
    return "content"


def _variance_allows(variance):
    return 2 if variance <= 3 else 3 if variance == 4 else 4 if variance <= 6 else 5


def read_slides(deck) -> dict:
    """Every slide's items, family, role, named and drawn treatment and (content slides) signature, with the deck's dials."""
    width, height = deck.slide_width / PT, deck.slide_height / PT
    stamp = STAMP.search(deck.core_properties.subject or "")
    density, variance = (int(stamp.group(2)), int(stamp.group(4))) if stamp else (5, 5)
    margin = SIDE_MARGIN[960 if round(width) == 960 else 720].get(stamp.group(3) if stamp else "standard", 48.0)
    slides = []
    for number, slide in enumerate(deck.slides, start=1):
        items = _items(slide, width, height)
        family = next((shape.name.split("@", 1)[1] for shape in slide.shapes if shape.name.startswith("family@")), "")
        title = next((item for item in items if item["name"].startswith("title@")), None)
        entry = {"n": number, "slide": slide, "items": items, "family": family, "role": _role(family), "title": title,
                 "named": title["name"].split("@", 1)[1] if title else None}
        entry["treatment"] = treatment_of(title, items, width, height) if title and title["sizes"] else None
        if entry["role"] == "content":
            entry["signature"] = signature(title, entry["treatment"], items, width, height, margin)
        slides.append(entry)
    return {"width": width, "height": height, "stamp": stamp, "density": density, "variance": variance, "slides": slides}


def check_output(deck) -> list:
    """OF-110..OF-113 and OF-115 over the whole deck."""
    read = read_slides(deck)
    width, height, stamp, density, variance, slides = (read[key] for key in ("width", "height", "stamp", "density", "variance", "slides"))
    if not any(entry["named"] for entry in slides):
        return []
    legacy = any(entry["named"] == "legacy" for entry in slides)
    variety = "MEDIUM" if legacy else "HIGH"
    found = []
    for entry in slides:
        if entry["named"] in TREATMENTS and entry["treatment"] not in (None, entry["named"]):
            found.append(_finding("OF-110", "HIGH", entry["n"], entry["title"]["name"],
                                  f"the title is drawn as {entry['treatment']}, named {entry['named']}",
                                  "Draw the treatment with its own frame and companions so the name matches the page."))
    # Covers and sections are variants of their own, so only the other titled slides are counted.
    titled = [entry for entry in slides if entry["role"] not in ("cover", "section") and entry["treatment"]]
    used = sorted({entry["treatment"] for entry in titled} - {"unclassified"})
    unknown = [entry["n"] for entry in titled if entry["treatment"] == "unclassified"]
    if len(slides) >= T["outputMinSlides"]:
        if variance <= 3 and len(used) < T["outputMinTreatments"]:
            found.append(_finding("OF-110", "MEDIUM", None, None, f"{len(used)} title treatment(s) at variance {variance}",
                                  "Variance under 4 is the user's choice; name it in the reply."))
        elif len(used) < T["outputMinTreatments"]:
            found.append(_finding("OF-110", variety, None, None, f"{len(used)} title treatment(s) ({', '.join(used) or 'none'}) on {len(slides)} slides",
                                  "Give slide roles the tonality's other treatments: data beside a side rail or over a bottom title, steps under a numeral."))
        elif stamp and len(used) > _variance_allows(variance):
            found.append(_finding("OF-110", variety, None, None, f"{len(used)} title treatments; variance {variance} allows {_variance_allows(variance)}",
                                  "Use fewer treatments, or raise variance by at most 2 without asking."))
    if unknown:
        found.append(_finding("OF-110", variety, unknown[0], None, f"no known treatment on slide(s) {', '.join(map(str, unknown))}",
                              "Let the compiler place the title on one of the eight treatment frames; never position it by hand."))
    content = [entry for entry in slides if entry["role"] == "content"]
    if len(content) >= 3:
        need = min(T["outputVarietyCap"], math.ceil(round(T["outputVarietyShare"] * len(content), 6)))
        problems = []
        for label, key in (("signature", lambda entry: entry["signature"]), ("layout", lambda entry: entry["signature"][:2])):
            counts = {}
            for entry in content:
                counts[key(entry)] = counts.get(key(entry), 0) + 1
            common, common_n = max(counts.items(), key=lambda pair: pair[1])
            if len(counts) < need:
                problems.append(f"{label}: {len(counts)} distinct, needs {need}")
            if common_n / len(content) > T["outputMaxShare"]:
                hit = [entry["n"] for entry in content if key(entry) == common]
                problems.append(f"{label}: {'/'.join(common)} on {common_n} of {len(content)} content slides ({', '.join(map(str, hit))})")
        if problems:
            found.append(_finding("OF-111", variety, None, None, "; ".join(problems),
                                  "Change the family or title treatment of the repeated slides; let each slide's job choose its shape."))
    cap = next(limit for upto, limit in T["outputBandCaps"] if density <= upto)
    bands = []
    for entry in slides:
        if entry["role"] in ("cover", "section") or entry["family"] in ("statement", "quote", "closing-statement") or entry["treatment"] == "statement":
            continue
        band = empty_band(entry["title"], entry["items"])
        if band is None:
            continue
        bands.append(band)
        if band > cap:
            found.append(_finding("OF-112", "MEDIUM", entry["n"], None, f"{band:.0%} of the body empty under the last block (cap {cap:.0%} at density {density})",
                                  "Follow the tonality's fill order: a grown visual, wider gaps, or a family that fits the content."))
    if bands:
        bands.sort()
        middle = len(bands) // 2
        median = bands[middle] if len(bands) % 2 else (bands[middle - 1] + bands[middle]) / 2
        if median > T["outputBandDeckMax"]:
            # A legacy template has no fill policies, so its median is advisory; OF-109 still blocks a hollow slide.
            found.append(_finding("OF-112", variety, None, None, f"median empty band {median:.2f} over {len(bands)} slides (limit {T['outputBandDeckMax']:.2f})",
                                  "Give content slides material that reaches the floor: a takeaway under a table, the next step under an ask."))
    groups = {}
    for entry in titled:
        if entry["treatment"] in TREATMENTS and entry["named"] in TREATMENTS:
            groups.setdefault(entry["treatment"], []).append(entry)
    # A statement is centred vertically, so only its x and width repeat. A bottom title stands on the floor:
    # its bottom edge repeats and its top moves with the line count.
    edge = lambda title, key: title["y"] + title["h"] if key == "bottom" else title[key]
    for treatment, group in groups.items():
        keys = ("x", "w") if treatment == "statement" else ("x", "w", "bottom") if treatment == "bottom-anchor" else ("x", "y", "w")
        modes = {}
        for key in keys:
            values = [round(edge(entry["title"], key)) for entry in group]
            modes[key] = max(set(values), key=values.count)
        for entry in group:
            off = [f"{key} {edge(entry['title'], key):.0f} vs {modes[key]}" for key in keys
                   if abs(edge(entry["title"], key) - modes[key]) > T["outputAnchorTolPt"]]
            if off:
                found.append(_finding("OF-113", "HIGH", entry["n"], entry["title"]["name"], f"{treatment} title off its frame: {', '.join(off)}",
                                      "Slides with one treatment share its title frame; fix the source instead of nudging a title."))
    return found + empty_regions(read) + agenda_numerals(read)


# OF-115. The empty band (OF-112) reads the body as one page, yet one region can stand empty beside a full
# one: the floor under a bottom title, the rail under a side title, the takeaway column beside a visual that
# runs on below it, the panel that carries a title over a picture, the open page above a plate. Each is read
# as a share of its own region, or under a bottom title as a distance.
def _title_end(title):
    """Where a top-aligned title's last line ends; the frame keeps spare lines, so its own bottom does not say."""
    frame = title["shape"].text_frame
    size = max(title["sizes"] or [0.0])
    usable = max(1.0, (title["shape"].width - frame.margin_left - frame.margin_right) / PT)
    bold = any(run.font.bold for paragraph in frame.paragraphs for run in paragraph.runs)
    count = sum(_measured_lines(paragraph.text, size, bold, usable) for paragraph in frame.paragraphs if paragraph.text.strip())
    return title["y"] + max(1, count) * size * 1.15


def _largest_gap(top, bottom, spans):
    """The tallest stretch of [top, bottom] that no (y0, y1) span covers."""
    gap, cursor = 0.0, top
    for y0, y1 in sorted(spans):
        if y1 <= cursor:
            continue
        gap = max(gap, min(y0, bottom) - cursor)
        cursor = max(cursor, y1)
    return max(gap, bottom - cursor)


def _short_column(entry, content, title, treatment, body_floor, column_five, width, height):
    """A column of a two-column body that stops short of the column beside it: its tallest empty band, from the
    top of the pair down to where the other column ends, over the share limit of the body. A source or note strip
    closing the column counts as a block but does not hide the band above it. Beside the figures of a kpi-row or
    big-number slide the column is measured to the body floor (spec-v2 Amendments 9)."""
    tol = T["outputGeometryTolPt"]
    # Under a top title the body starts below it; beside a side title (its rail left out) or over a bottom title, at the top.
    start = title["y"] + title["h"] if treatment not in ("bottom-anchor", "side-rail") else 0.0
    fields = [item for item in entry["items"] if item["kind"] == "shape" and item["filled"] and item["w"] * item["h"] >= 0.1 * width * height]
    body = [item for item in content if start - tol <= item["y"] < body_floor and item["w"] > 0 and item["h"] > 0
            and not (treatment == "side-rail" and item["x"] + item["w"] <= column_five + tol) and not any(_inside(item, field) for field in fields)]
    if len(body) < 2:
        return None
    left, right = min(item["x"] for item in body), max(item["x"] + item["w"] for item in body)
    for cut in sorted({item["x"] + item["w"] for item in body}):
        a = [item for item in body if item["x"] + item["w"] <= cut + tol]
        b = [item for item in body if item["x"] >= cut - tol]
        # A block across most of the body (a note under both columns) belongs to neither; a narrower block across
        # the cut means no column line runs there.
        across = [item for item in body if item not in a and item not in b]
        if not a or not b or any(item["w"] < T["outputWideBlockShare"] * (right - left) for item in across):
            continue
        top = min(item["y"] for item in a + b)
        for column, other in ((a, b), (b, a)):
            # Takeaways beside a chart that close with the chart's values: that table is part of the column, at its drawn extent.
            values = any(item["kind"] == "chart" for item in other) and any(item["kind"] == "text" for item in column) \
                and not any(item["kind"] in ("chart", "picture") for item in column)
            # A text column, or a picture drawn smaller than its column, beside a column that runs on.
            if not any(item["kind"] in ("text", "picture") for item in column) or (any(item["kind"] in ("chart", "table") for item in column) and not values):
                continue
            # Row heads (a matrix's or a comparison's short labels, each level with its row) are no column to fill.
            if all(item["kind"] == "text" and item["h"] <= 56 and len(re.sub(r"\s+", "", item["text"])) <= 16 for item in column):
                continue
            # Read whatever the neighbour's length: one that stops short still marks how far this column should run.
            reach = min(body_floor, max(item["y"] + item["h"] for item in other))
            # A takeaway column beside the figures of a kpi-row or big-number slide runs to the body floor: the rows stop
            # where their spacing ends. The figures' own labels stand exactly level with figures below the first row.
            size = lambda side: max([max(item["sizes"]) for item in side if item["kind"] == "text" and item["sizes"]] or [0.0])  # noqa: E731
            figures = [item for item in other if item["kind"] == "text" and item["sizes"] and max(item["sizes"]) > size(column) + 4]
            labels = any(abs(item["y"] - f["y"]) <= 0.5 and f["y"] > top + tol for item in column for f in figures)
            if entry["family"] in ("kpi-row", "big-number") and figures and not labels:
                reach = body_floor
            share = _largest_gap(top, reach, [(item["y"], item["y"] + item["h"]) for item in column]) / max(1.0, body_floor - top)
            if share > T["outputRegionEmptyShare"]:
                what = "picture" if any(item["kind"] == "picture" for item in column) else "text"
                return _finding("OF-115", "HIGH", entry["n"], column[0]["name"], f"the {what} column beside a longer one leaves {share:.0%} of the body empty inside it",
                                "Fill the column by layout: lead size, the source and values in the column, a narrower column with a wider visual, or the points under the visual.")
    return None


def empty_regions(read) -> list:
    width, height = read["width"], read["height"]
    floor, tol, share_max = T["outputBandFloorPt"], T["outputGeometryTolPt"], T["outputRegionEmptyShare"]
    column_five = RAIL.get(round(width), RAIL[960])[1]
    found = []
    for entry in read["slides"]:
        title, treatment = entry["title"], entry["treatment"]
        if title is None:
            continue
        full_bleed = lambda item: item["kind"] == "picture" and item["w"] * item["h"] >= 0.8 * width * height
        content = [item for item in entry["items"] if item is not title and item["role"] != "decoration" and not _footer(item) and not full_bleed(item)]
        if entry["role"] in ("content", "closing") and title["sizes"]:
            if treatment == "bottom-anchor":
                gap = floor - _title_end(title)
                if gap > T["outputRegionFloorGapPt"]:
                    found.append(_finding("OF-115", "HIGH", entry["n"], title["name"], f"the bottom title ends {gap:.0f} pt above the body floor",
                                          "Stand the title's last line on the floor and give the visual above it the room."))
            if treatment == "side-rail" and entry["family"] not in ("quote", "statement"):
                top = title["y"] + title["h"]
                rail = [item for item in content if item["x"] + item["w"] <= column_five + tol and item["y"] + item["h"] > top]
                share = _largest_gap(top, floor, [(item["y"], item["y"] + item["h"]) for item in rail]) / max(1.0, floor - top)
                if share > share_max:
                    found.append(_finding("OF-115", "HIGH", entry["n"], title["name"], f"{share:.0%} of the side rail under the title is empty",
                                          "Put the slide's criteria labels, takeaways or source in the rail, or give it a top or bottom title."))
            # The takeaway column beside a chart, table or picture that runs on below it. Text on a colour
            # field (a closing's ask) stands on its own ground and is no column.
            body_floor = title["y"] - tol if treatment == "bottom-anchor" else floor
            fields = [item for item in entry["items"] if item["kind"] == "shape" and item["filled"] and item["w"] * item["h"] >= 0.1 * width * height]
            short = _short_column(entry, content, title, treatment, body_floor, column_five, width, height)
            if short:
                found.append(short)
            for visual in ([] if short else [item for item in content if item["kind"] in ("chart", "table", "picture")]):
                beside = [item for item in content if item["kind"] == "text" and item["y"] < visual["y"] + visual["h"] and item["y"] + item["h"] > visual["y"]
                          and (item["x"] >= visual["x"] + visual["w"] - tol or item["x"] + item["w"] <= visual["x"] + tol)
                          and not any(_inside(item, field) for field in fields)]
                if not beside:
                    continue
                left, right = min(item["x"] for item in beside), max(item["x"] + item["w"] for item in beside)
                centre = lambda item: item["x"] + item["w"] / 2
                top = min([visual["y"]] + [item["y"] for item in beside])
                column = max(item["y"] + item["h"] for item in content if left - tol <= centre(item) <= right + tol)
                reach = min(body_floor, max(item["y"] + item["h"] for item in content if visual["x"] - tol <= centre(item) <= visual["x"] + visual["w"] + tol))
                share = (reach - column) / max(1.0, body_floor - top)
                if share > share_max:
                    found.append(_finding("OF-115", "HIGH", entry["n"], visual["name"], f"the column beside the {visual['kind']} leaves {share:.0%} of the body empty under its last block",
                                          "Close the column with the source and note, the chart's values or the takeaways; never stretch the visual alone."))
                    break
        if entry["role"] in ("cover", "section") or treatment in ("statement", "overlay"):
            # A title panel over a picture, and a plate under a statement or quote. A typographic cover's plate
            # is the cover's own device, not a region its text must fill.
            pictured = any(full_bleed(item) for item in entry["items"])
            panels = [item for item in entry["items"] if item["kind"] == "shape" and item["filled"] and _inside(title, item) and item["w"] * item["h"] < 0.9 * width * height]
            for panel in panels:
                inside = [item for item in content + [title] if item is not panel and _inside(item, panel)]
                if panel["y"] > tol and pictured:
                    bottom = min(panel["y"] + panel["h"], floor)
                    share = _largest_gap(panel["y"], bottom, [(item["y"], item["y"] + item["h"]) for item in inside]) / max(1.0, bottom - panel["y"])
                    if share > share_max:
                        found.append(_finding("OF-115", "HIGH", entry["n"], panel["name"], f"{share:.0%} of the panel that carries the title is empty",
                                              "Make the panel as tall as the title and its lines, standing on the page foot."))
                if panel["y"] > tol and treatment == "statement" and panel["w"] >= 0.9 * width and not any(item["y"] + item["h"] <= panel["y"] + tol for item in content):
                    found.append(_finding("OF-115", "HIGH", entry["n"], panel["name"], "a plate under part of the page leaves the open page above it empty",
                                          "Set the sentence on the whole-page field or on the open page; a plate needs content above it."))
    return found


# OF-116. A deck's skeleton is each content slide's title zone and column partition, read as OF-111 reads
# them. Two tonalities of one source with the same skeleton differ in colour only.
def skeleton(deck) -> list:
    return [entry["signature"][:2] for entry in read_slides(deck)["slides"] if entry["role"] == "content"]


def compare_skeletons(path, sibling) -> list:
    mine, theirs = skeleton(Presentation(str(path))), skeleton(Presentation(str(sibling)))
    count = min(len(mine), len(theirs))
    if not count:
        return []
    differ = sum(1 for a, b in zip(mine, theirs) if a != b)
    # One differing slide left a longer deck reading as one deck in two colours.
    need = T["outputSiblingMinDifferLong"] if count >= T["outputSiblingLongDeck"] else T["outputSiblingMinDiffer"]
    if differ >= need:
        return []
    return [_finding("OF-116", "HIGH", None, None, f"{differ} of {count} content slides differ in title zone or partition from {Path(sibling).name} (needs {need})",
                     "Give the tonality its own structure: its role defaults, another title zone or partition on the slides it shares with the other.")]


# OF-118. A point that opens with a bold label and runs on in regular weight reads as one sentence when nothing
# parts the two ("요약 누리집에서 …"): the label carries a colon unless it ends in a separator of its own.
RUN_IN_SEPARATOR = re.compile(r"[:：.)\]?!–—\-]$")


def check_run_ins(deck) -> list:
    found = []
    for number, slide in enumerate(deck.slides, start=1):
        for shape in slide.shapes:
            if not getattr(shape, "has_text_frame", False) or shape.name.startswith(("title@", "lit-notice")):
                continue
            for paragraph in shape.text_frame.paragraphs:
                runs = [run for run in paragraph.runs if run.text]
                if len(runs) < 2 or not runs[0].font.bold or runs[1].font.bold:
                    continue
                label, rest = runs[0].text.strip(), runs[1].text
                if not label or not re.search(r"\w", rest) or RUN_IN_SEPARATOR.search(label) or rest.lstrip()[:1] in ":：":
                    continue
                found.append(_finding("OF-118", "HIGH", number, shape.name, f"a bold run-in label without a separator: {(runs[0].text + rest)[:40]}",
                                      "Write the label with its colon (**요약:** …) or let the compiler add it; a bold label never runs into its sentence."))
    return found


# OF-119. An agenda numbers its rows; a numeral beside its title repeats their count and reads as a stray section number.
def agenda_numerals(read) -> list:
    return [_finding("OF-119", "HIGH", entry["n"], entry["title"]["name"], "a numeral beside the agenda title repeats the count of its numbered rows",
                     "Give the agenda a title without a numeral; its rows carry the numbers.")
            for entry in read["slides"] if entry["family"] == "agenda" and entry["treatment"] == "kicker-numeral"]


# OF-117. A chart or diagram exported on white and placed on a dark ground reads as a white card with small
# grey labels. Such a figure is a picture of mostly near-white pixels; a photograph rarely is.
def check_figures(deck) -> list:
    width, height = deck.slide_width / PT, deck.slide_height / PT
    found = []
    for number, slide in enumerate(deck.slides, start=1):
        try:
            ground = slide.background.fill.fore_color.rgb if slide.background.fill.type == 1 else None
        except (AttributeError, TypeError, ValueError):
            ground = None
        if ground is None:
            continue
        r, g, b = (int(str(ground)[i:i + 2], 16) / 255 for i in (0, 2, 4))
        if 0.2126 * r + 0.7152 * g + 0.0722 * b > T["figureGroundLuminanceMax"]:
            continue
        import io
        from PIL import Image
        for shape in slide.shapes:
            if shape.shape_type != MSO_SHAPE_TYPE.PICTURE or shape.width is None:
                continue
            area = shape.width / PT * shape.height / PT
            if not T["figureMinArea"] * width * height <= area < 0.8 * width * height:
                continue
            with Image.open(io.BytesIO(shape.image.blob)) as image:
                raw = image.convert("RGB").resize((64, 64)).tobytes()
            share = sum(1 for i in range(0, len(raw), 3) if min(raw[i:i + 3]) >= T["figureNearWhite"]) / (len(raw) / 3)
            if share > T["figureLightShare"]:
                found.append(_finding("OF-117", "HIGH", number, shape.name, f"a light figure ({share:.0%} near-white) on a dark ground",
                                      "Put the figure's dark variant beside it (name.dark.png) or draw it as a native chart."))
    return found


# A Korean title is read on its last word: a sentence ending or a nominalised claim makes it a
# sentence. An English title is read for a final period or a finite verb. A trailing parenthesis is
# set aside first, and a question is never a claim.
KO_ENDING = re.compile(r"(?:니다|[어아해세에예네지군래게]요|죠|[었았였했겠됐](?:다|음)|[가-힣]다|[가-힣](?:함|됨)|(?:있|없)음)$")
KO_NOUNS = {"바다", "판다", "소다", "람다", "캐나다", "어젠다", "아젠다", "포함", "보다", "함", "다"}
EN_AUXILIARY = re.compile(r"\b(?:is|are|was|were|has|have|had|will|would|can|could|should|must|does|did|won't|isn't|aren't|wasn't|doesn't|didn't)\b", re.I)
EN_REPORT_VERBS = {
    "grew", "grows", "rose", "rises", "fell", "falls", "doubled", "doubles", "tripled", "triples", "halved", "halves",
    "increased", "increases", "decreased", "decreases", "declined", "declines", "improved", "improves", "dropped", "drops",
    "climbed", "climbs", "beats", "outperforms", "outperformed", "leads", "drives", "drove", "shows", "showed", "needs",
    "makes", "reached", "reaches", "exceeded", "exceeds", "missed", "misses", "stays", "stayed", "remains", "remained",
    "comes", "came", "takes", "took", "works", "worked", "pays", "paid", "saves", "saved", "explains", "explained",
    "matters", "wins", "won", "lost", "loses", "cuts", "lifts", "lifted", "slowed", "slows", "fails", "failed",
}


def is_sentence(text: str) -> bool:
    """True when a title or subtitle states a claim instead of naming a topic."""
    value = re.sub(r"\s+", " ", str(text or "")).strip()
    value = re.sub(r"\s*\([^()]*\)$", "", value).strip().rstrip("\"'”’")
    if not value or value.endswith("?") or value[0] in "“\"「『‘'":
        return False
    if re.search(r"[가-힣]", value):
        last = re.sub(r"[.!…]+$", "", value.split(" ")[-1])
        return last not in KO_NOUNS and bool(KO_ENDING.search(last))
    if value.endswith((".", "!")):
        return True
    words = re.findall(r"[A-Za-z']+", value)
    return bool(EN_AUXILIARY.search(value)) or any(word.lower() in EN_REPORT_VERBS for word in words[1:])


def check_labels(deck) -> list:
    """OF-114 over every compiler-drawn title and the cover subtitle."""
    named = [(number, shape) for number, slide in enumerate(deck.slides, start=1) for shape in slide.shapes
             if shape.name.startswith(("title@", "subtitle@")) and getattr(shape, "has_text_frame", False)]
    legacy = any(shape.name == "title@legacy" for _, shape in named)
    found = []
    for number, shape in named:
        text = _text(shape)
        if is_sentence(text):
            what = "subtitle" if shape.name.startswith("subtitle@") else "title"
            found.append(_finding("OF-114", "MEDIUM" if legacy else "HIGH", number, shape.name, f"the {what} is a sentence: {text[:60]}",
                                  "Name the topic (분기별 매출 추이; Conversion by feed rate) and move the claim into the first takeaway or caption."))
    return found
