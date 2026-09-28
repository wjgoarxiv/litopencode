import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('document craft gate distinguishes clean and rule-specific broken files', () => {
  const result = spawnSync('python3', ['test/uiux_office_docx.py'], { encoding: 'utf8', timeout: 30000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
