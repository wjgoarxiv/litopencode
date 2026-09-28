from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN
from pptx.oxml.xmlchemy import OxmlElement
from pptx.util import Inches, Pt

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'skills/lit-pptx/scripts'))
from craft_extras import analyse  # noqa: E402
from qa_deck import qa  # noqa: E402


class OfficeCraftTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.deck = Presentation()
        self.deck.slide_width = Inches(13.33)
        self.deck.slide_height = Inches(7.5)
        self.slide = self.deck.slides.add_slide(self.deck.slide_layouts[6])

    def check(self, rule):
        path = Path(self.temp.name) / 'case.pptx'
        self.deck.save(path)
        return [finding for finding in analyse(path)['findings'] if finding['rule'] == rule]

    def textbox(self, text, x=1, y=1, w=3, h=1, size=18):
        box = self.slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
        box.text = text
        box.text_frame.paragraphs[0].runs[0].font.size = Pt(size)
        return box

    def test_clean_slide(self):
        self.textbox('Example process', w=5, size=32)
        self.textbox('Clear supporting copy.', y=2, w=5)
        self.assertEqual(analyse(self._save())['findings'], [])
        self.assertIn('craft', qa(self._save()))

    def _save(self):
        path = Path(self.temp.name) / 'case.pptx'
        self.deck.save(path)
        return path

    def test_accent_family(self):
        for index, rgb in enumerate([(220, 30, 30), (30, 170, 50), (40, 70, 220)]):
            shape = self.slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(1 + index * 2), Inches(2), Inches(1), Inches(1))
            shape.fill.solid()
            shape.fill.fore_color.rgb = RGBColor(*rgb)
        self.assertTrue(self.check('OF-101'))

    def test_numeric_column_alignment(self):
        table = self.slide.shapes.add_table(3, 2, Inches(1), Inches(2), Inches(6), Inches(2)).table
        for row, value in enumerate(['Amount', '120', '340']):
            table.cell(row, 1).text = value
            table.cell(row, 1).text_frame.paragraphs[0].alignment = PP_ALIGN.LEFT
        self.assertTrue(self.check('OF-103'))
        for row in (1, 2):
            table.cell(row, 1).text_frame.paragraphs[0].alignment = PP_ALIGN.RIGHT
        self.assertFalse(self.check('OF-103'))

    def test_body_measure_and_empty_band(self):
        self.textbox('A' * 220, x=.5, y=2, w=12, h=1.5, size=11)
        self.assertTrue(self.check('OF-102'))
        self.assertTrue(self.check('OF-109'))

    def test_concentric_radius(self):
        self.slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(1), Inches(2), Inches(4), Inches(3))
        self.slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(1.2), Inches(2.2), Inches(3.6), Inches(2.6))
        self.assertTrue(self.check('OF-104'))

    def test_explicit_group_ratio(self):
        for x in (1, 6.7):
            panel = self.slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(2), Inches(5.5), Inches(4))
            panel.fill.solid()
            panel.fill.fore_color.rgb = RGBColor(240, 240, 240)
            self.textbox('First line', x=x+.2, y=2.3, w=2, h=.4)
            self.textbox('Second line', x=x+.2, y=3.1, w=2, h=.4)
        self.assertTrue(self.check('OF-105'))

    def test_gradient_glow_and_emoji_bullet(self):
        shape = self.textbox('An example', y=2)
        run = shape.text_frame.paragraphs[0].runs[0]
        run._r.get_or_add_rPr().append(OxmlElement('a:gradFill'))
        shape._element.spPr.get_or_add_effectLst().append(OxmlElement('a:glow'))
        shape.text_frame.paragraphs[0]._p.get_or_add_pPr().append(OxmlElement('a:buChar'))
        shape.text_frame.paragraphs[0]._p.pPr[-1].set('char', '🚀')
        for rule in ('OF-106', 'OF-107', 'OF-108'):
            self.assertTrue(self.check(rule), rule)


if __name__ == '__main__':
    unittest.main()
