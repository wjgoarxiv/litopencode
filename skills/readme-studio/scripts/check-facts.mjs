import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { inside, readRegular } from '../templates/typography/files.mjs';

export function checkFacts(facts, root) {
  const keys = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => allowed.includes(k));
  const nonempty = s => typeof s === 'string' && s.trim().length > 0 && s.length <= 4096;
  if (!keys(facts, ['claims','badges']) || !Array.isArray(facts.claims) || !facts.claims.length || facts.claims.length > 200 || !Array.isArray(facts.badges) || facts.badges.length > 20) throw new Error('invalid facts structure');
  const ids = new Set();
  for (const claim of facts.claims) {
    if (!keys(claim, ['id','text','sources']) || !nonempty(claim.id) || ids.has(claim.id) || !nonempty(claim.text) || !Array.isArray(claim.sources) || !claim.sources.length || claim.sources.length > 20) throw new Error('invalid or duplicate claim');
    ids.add(claim.id);
    for (const source of claim.sources) readRegular(inside(root, source), 8 * 1048576);
  }
  for (const badge of facts.badges) {
    if (!keys(badge, ['label','url','claim']) || !nonempty(badge.label) || !ids.has(badge.claim) || !nonempty(badge.url) || /[\s\x00-\x1f\x7f]/u.test(badge.url)) throw new Error('invalid badge');
    const url = new URL(badge.url);
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password || !url.hostname) throw new Error('unsafe badge URL');
  }
  return {valid:true, validation_scope:'structure-only', factual_accuracy:'not-checked', source_contents_compared:false, badge_truth_checked:false};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const {values} = parseArgs({options:{root:{type:'string'},facts:{type:'string'}}});
    if (!values.root || !values.facts) throw new Error('--root and --facts required');
    console.log(JSON.stringify(checkFacts(JSON.parse(readRegular(inside(values.root, values.facts))), values.root)));
  } catch (error) { console.error(`readme-studio: ${error.message}`); process.exitCode = 1; }
}
