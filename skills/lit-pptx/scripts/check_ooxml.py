#!/usr/bin/env python3
"""Check a PPTX package after font embedding without external schema files."""

import argparse
import posixpath
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from pptx import Presentation


def check(path):
    with zipfile.ZipFile(path) as archive:
        names = set(archive.namelist())
        if archive.testzip() is not None:
            raise ValueError("ZIP CRC check failed")
        required = {"[Content_Types].xml", "_rels/.rels", "ppt/presentation.xml"}
        if not required <= names:
            raise ValueError("missing required OOXML part")
        content_types = ET.fromstring(archive.read("[Content_Types].xml"))
        declared = {node.attrib.get("PartName", "").lstrip("/") for node in content_types if node.tag.endswith("Override")}
        if "ppt/presentation.xml" not in declared:
            raise ValueError("presentation content type missing")
        for name in names:
            if not name.endswith(".rels"):
                continue
            root = ET.fromstring(archive.read(name))
            base = "" if name == "_rels/.rels" else posixpath.dirname(posixpath.dirname(name))
            for relation in root:
                target = relation.attrib.get("Target", "")
                if relation.attrib.get("TargetMode") == "External":
                    continue
                resolved = posixpath.normpath(posixpath.join(base, target.lstrip("/")))
                if target.startswith("/"):
                    resolved = target.lstrip("/")
                if resolved not in names:
                    raise ValueError(f"missing relationship target: {name} -> {target}")
    Presentation(str(path))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("pptx", type=Path)
    args = parser.parse_args()
    check(args.pptx)
    print("OOXML integrity PASS")
