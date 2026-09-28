#!/usr/bin/env python3
"""First-use Python runtime for the installed OpenCode document skill."""

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CACHE = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "litopencode" / "office"
LOCK = ROOT / "requirements.lock"
VENV = CACHE / ("python-docx-" + hashlib.sha256(LOCK.read_bytes()).hexdigest()[:16])
COMMANDS = {
    "md-to-docx": "convert_md_to_docx.py",
    "md-to-pdf": "convert_md_to_pdf.py",
    "pdf-to-md": "convert_pdf.py",
    "edit": "edit_docx.py",
    "lint": "slop_lint.py",
    "audit": "visual_audit.py",
    "clean-md": "clean_markdown.py",
    "embed-images": "embed_images.py",
    "templates": "generate_docx_templates.py",
}


def ready():
    return (VENV / "bin" / "python").is_file()


def prepare():
    if ready():
        return
    CACHE.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix="python-install-", dir=CACHE))
    try:
        print("Installing LitOpenCode office Python dependencies in its cache.", file=sys.stderr)
        subprocess.run([sys.executable, "-m", "venv", str(temporary)], check=True)
        subprocess.run([str(temporary / "bin" / "python"), "-m", "pip", "install", "--disable-pip-version-check", "--require-hashes", "-r", str(LOCK)], check=True)
        temporary.rename(VENV)
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Usage: python3 run.py <md-to-docx|md-to-pdf|pdf-to-md|edit|lint|audit|clean-md|embed-images|templates|doctor> [arguments]")
    command, *args = sys.argv[1:]
    if command == "doctor":
        print(json.dumps({"pythonReady": ready()}))
        return
    if command not in COMMANDS:
        raise SystemExit(f"Unknown command: {command}")
    prepare()
    environment = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
    raise SystemExit(subprocess.run([str(VENV / "bin" / "python"), str(ROOT / "scripts" / COMMANDS[command]), *args], env=environment).returncode)


if __name__ == "__main__":
    main()
