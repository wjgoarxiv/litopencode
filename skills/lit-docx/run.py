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
    "qa": "craft_docx.py",
    "audit": "visual_audit.py",
    "clean-md": "clean_markdown.py",
    "embed-images": "embed_images.py",
    "templates": "generate_docx_templates.py",
}


def venv_python(venv, platform=sys.platform):
    """A venv keeps its interpreter in Scripts on Windows and in bin elsewhere."""
    return venv / ("Scripts/python.exe" if platform == "win32" else "bin/python")


def run_script(python, script, args, env=None):
    """Run one script as a child and return its exit code, so a failed gate fails the caller on every platform."""
    return subprocess.run([str(python), str(script), *args], env=env).returncode


def probe_python(command):
    """The version a Python command reports, or None when it does not start."""
    try:
        result = subprocess.run([command, "-c", "import sys; print('%d.%d.%d' % sys.version_info[:3])"], capture_output=True, text=True, timeout=15)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return result.stdout.strip() if result.returncode == 0 else None


def supported_python(minimum=10, maximum=14, override=None, probe=probe_python):
    """The Python the venv is built from. The pinned wheels stop at 3.14, so a newer python3 (such as 3.15)
    would fail pip; an override is used alone, else the newest python3.X in range on PATH, then python3 and python."""
    candidates = [override] if override else [f"python3.{minor}" for minor in range(maximum, minimum - 1, -1)] + ["python3", "python"]
    passed = []
    for command in candidates:
        version = probe(command)
        if version is None:
            if override:
                passed.append(f"{command}: not found")
            continue
        major, minor = (int(part) for part in version.split(".")[:2])
        if major == 3 and minimum <= minor <= maximum:
            return command
        passed.append(f"{command}: {version} is {'newer' if minor > maximum else 'older'} than 3.{maximum if minor > maximum else minimum}")
    tried = "; " + ", ".join(passed) if passed else " on PATH"
    raise SystemExit(f"no supported Python (3.{minimum} to 3.{maximum}){tried}. Install Python 3.{minimum} to 3.{maximum}, or set LITOPENCODE_OFFICE_PYTHON to one.")


def ready():
    return venv_python(VENV).is_file()


def prepare():
    if ready():
        return
    CACHE.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix="python-install-", dir=CACHE))
    try:
        print("Installing LitOpenCode office Python dependencies in its cache.", file=sys.stderr)
        subprocess.run([supported_python(override=os.environ.get("LITOPENCODE_OFFICE_PYTHON")), "-m", "venv", str(temporary)], check=True)
        subprocess.run([str(venv_python(temporary)), "-m", "pip", "install", "--disable-pip-version-check", "--require-hashes", "-r", str(LOCK)], check=True)
        temporary.rename(VENV)
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Usage: python3 run.py <md-to-docx|md-to-pdf|pdf-to-md|edit|lint|qa|audit|clean-md|embed-images|templates|doctor> [arguments]")
    command, *args = sys.argv[1:]
    if command == "doctor":
        print(json.dumps({"pythonReady": ready()}))
        return
    if command not in COMMANDS:
        raise SystemExit(f"Unknown command: {command}")
    prepare()
    environment = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
    raise SystemExit(run_script(venv_python(VENV), ROOT / "scripts" / COMMANDS[command], args, environment))


if __name__ == "__main__":
    main()
