import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { probePython, supportedPython } from '../skills/lit-pptx/command.mjs';

// The gate runs the deck checks with python-pptx, so it needs a Python the office pins cover (3.10 to
// 3.14) that already has python-pptx; a python3 that is 3.15 has neither the wheels nor the module.
const withPptx = (command, env) => {
  const found = probePython(command, env);
  if (!found.ok) return found;
  return spawnSync(command, ['-c', 'import pptx'], { env }).status === 0 ? found : { ok: false, command, detail: 'has no python-pptx' };
};

test('slide craft gate distinguishes clean and rule-specific broken decks', (t) => {
  const python = supportedPython({ min: 10, max: 14, override: process.env.LITOPENCODE_OFFICE_PYTHON, probe: withPptx });
  if (!python.ok) return t.skip(`needs Python 3.10 to 3.14 with python-pptx: ${python.detail}`);
  const result = spawnSync(python.command, ['test/uiux_office_pptx.py'], { encoding: 'utf8', timeout: 30000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
