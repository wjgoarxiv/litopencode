import assert from 'node:assert/strict';
import { test } from 'node:test';
import { visualQuality } from '../skills/lit-diagram-drawer/scripts/visual-quality.mjs';

const svg = (body) => `<svg viewBox="0 0 600 400" xmlns="http://www.w3.org/2000/svg"><title>Example flow</title><desc>Generic process</desc>${body}</svg>`;
const node = (id, x, y, fill = '#e5e7eb', w = 60) => `<rect data-node-id="${id}" x="${x}" y="${y}" width="${w}" height="60" fill="${fill}"/>`;
const result = (body) => visualQuality(svg(body));
const codes = (body) => result(body).issues.join('\n');

test('diagram craft checks preserve a clean simple node', () => {
  const result = codes(`${node('a', 60, 80)}<text data-node-for="a" x="65" y="115" font-size="16">Start</text>`);
  for (const code of ['CLUSTER_GAP_RATIO', 'ACCENT_COUNT', 'LABEL_CASE', 'LABEL_OVERFLOW']) assert.doesNotMatch(result, new RegExp(code));
});

test('diagram craft checks flag group ratio, accents, case and label width', () => {
  const clustered = codes(`<rect data-group-id="first" x="0" y="40" width="160" height="140"/><rect data-group-id="second" x="165" y="40" width="200" height="140"/>${node('a', 10, 80)}${node('b', 100, 80)}${node('c', 175, 80)}${node('d', 265, 80)}`);
  assert.match(clustered, /CLUSTER_GAP_RATIO/);
  const accents = codes(`${node('a', 10, 80, '#e11d48')}${node('b', 110, 80, '#16a34a')}${node('c', 210, 80, '#2563eb')}${node('d', 310, 80, '#d97706')}`);
  assert.match(accents, /ACCENT_COUNT/);
  const labels = result(`${node('a', 50, 80)}<text data-node-for="a" x="55" y="115" font-size="16">Review Of The Example Process</text>`);
  assert.match(labels.advisories.join('\n'), /LABEL_CASE/);
  assert.match(labels.issues.join('\n'), /LABEL_OVERFLOW/);
});
