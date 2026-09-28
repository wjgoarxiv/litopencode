#!/usr/bin/env python3
"""Inspect authored slide objects for off-canvas and text-frame overflow.

The report shape is consumed by qa_deck.py. Decorative backgrounds and intentional
layering are not counted as defects; semantic overlap is checked by that gate.
"""

import argparse
import json
from pathlib import Path

from pptx import Presentation
from pptx.util import Inches


def inspect(path):
    deck = Presentation(path)
    report = {}
    tolerance = Inches(0.04)
    for slide_number, slide in enumerate(deck.slides, 1):
        issues = {}
        for index, shape in enumerate(slide.shapes, 1):
            if not (shape.has_text_frame or shape.shape_type == 13):
                continue
            name = f"shape_{index}"
            overflow = {}
            off_slide = (shape.left < -tolerance or shape.top < -tolerance or
                         shape.left + shape.width > deck.slide_width + tolerance or
                         shape.top + shape.height > deck.slide_height + tolerance)
            if off_slide:
                visible_width = max(0, min(shape.left + shape.width, deck.slide_width) - max(shape.left, 0))
                visible_height = max(0, min(shape.top + shape.height, deck.slide_height) - max(shape.top, 0))
                visible_fraction = visible_width * visible_height / max(1, shape.width * shape.height)
                # The enrolled cover deliberately bleeds decorative pictures beyond
                # the canvas. Record a partial bleed, but fail a nearly lost picture.
                if shape.has_text_frame or visible_fraction < 0.5:
                    overflow["slide"] = "object extends past slide boundary"
            if shape.has_text_frame and shape.text.strip():
                frame = shape.text_frame
                usable_height = max(0, shape.height - frame.margin_top - frame.margin_bottom)
                usable_width = max(1, shape.width - frame.margin_left - frame.margin_right)
                estimated = 0
                for paragraph in frame.paragraphs:
                    if not paragraph.text.strip():
                        continue
                    sizes = [run.font.size.pt for run in paragraph.runs if run.font.size]
                    size = max(sizes, default=16)
                    approximate_chars = max(1, usable_width / Inches(size / 72 * 0.52))
                    line_count = max(1, sum(max(1, -(-len(line) // approximate_chars)) for line in paragraph.text.splitlines()))
                    estimated += line_count * Inches(size / 72 * 1.15)
                if estimated > usable_height + Inches(0.08):
                    overflow["frame"] = "estimated text height exceeds frame"
            if overflow or off_slide:
                issues[name] = {"overflow": overflow, **({"off_slide": True} if off_slide else {})}
        if issues:
            report[str(slide_number)] = issues
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--issues-only", action="store_true")
    args = parser.parse_args()
    args.output.write_text(json.dumps(inspect(args.input), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
