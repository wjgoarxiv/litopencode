from __future__ import annotations

import sys
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'skills/lit-docx/scripts'))
from craft_docx import analyse  # noqa: E402

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'


def make_docx(path, *, width=12240, align='right'):
    table = f'<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Amount</w:t></w:r></w:p></w:tc></w:tr>'
    for amount in ('120', '340'):
        jc = f'<w:jc w:val="{align}"/>' if align else ''
        table += f'<w:tr><w:tc><w:p><w:pPr>{jc}</w:pPr><w:r><w:t>{amount}</w:t></w:r></w:p></w:tc></w:tr>'
    table += '</w:tbl>'
    document = f'<w:document xmlns:w="{W}"><w:body><w:p><w:r><w:t>Example report body with enough prose to assess the line measure.</w:t></w:r></w:p>{table}<w:sectPr><w:pgSz w:w="{width}"/><w:pgMar w:left="1440" w:right="1440"/></w:sectPr></w:body></w:document>'
    styles = f'<w:styles xmlns:w="{W}"><w:style w:styleId="Normal"><w:rPr><w:sz w:val="22"/></w:rPr></w:style></w:styles>'
    with zipfile.ZipFile(path, 'w') as archive:
        archive.writestr('word/document.xml', document)
        archive.writestr('word/styles.xml', styles)


class OfficeDocumentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'example.docx'

    def test_clean_document(self):
        make_docx(self.path)
        self.assertEqual(analyse(self.path), [])

    def test_wide_prose_measure_is_advisory(self):
        make_docx(self.path, width=17280)
        findings = analyse(self.path)
        self.assertTrue(any(item['rule'] == 'OF-301' and item['severity'] == 'MEDIUM' for item in findings))

    def test_numeric_alignment_is_high_or_inherited_advisory(self):
        make_docx(self.path, align='left')
        self.assertTrue(any(item['rule'] == 'OF-302' and item['severity'] == 'HIGH' for item in analyse(self.path)))
        make_docx(self.path, align=None)
        self.assertTrue(any(item['rule'] == 'OF-302' and item['severity'] == 'MEDIUM' and item['tier'] == 'derived' for item in analyse(self.path)))

    def test_installed_lint_route_reports_the_new_rule(self):
        make_docx(self.path, align='left')
        repo = Path(__file__).resolve().parents[1]
        result = subprocess.run([sys.executable, str(repo / 'skills/lit-docx/run.py'), 'lint', '--publisher', 'elsevier', '--locale', 'en', '--audit-output', str(self.path), '--report', str(Path(self.temp.name) / 'audit.md')], capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn('rule-62-numeric-alignment HIGH/measured', result.stdout)


if __name__ == '__main__':
    unittest.main()
