import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {checkFacts} from '../skills/readme-studio/scripts/check-facts.mjs';
import {outline} from '../skills/readme-studio/templates/typography/outline.mjs';
import {readRegular,writeFresh} from '../skills/readme-studio/templates/typography/files.mjs';
function fixture(fn){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'readme-studio-')));try{fn(root);}finally{fs.rmSync(root,{recursive:true,force:true});}}
test('facts validate safe references without certifying claim or badge truth',()=>fixture(root=>{
 fs.writeFileSync(path.join(root,'package.json'),'{"private":true}');
 const data={claims:[{id:'purpose',text:'unsupported semantic claim',sources:['package.json']}],badges:[]};
 assert.deepEqual(checkFacts(data,root),{valid:true,validation_scope:'structure-only',factual_accuracy:'not-checked',source_contents_compared:false,badge_truth_checked:false});
 for(const source of ['../outside','/etc/passwd','missing','./package.json']) assert.throws(()=>checkFacts({...data,claims:[{...data.claims[0],sources:[source]}]},root));
 fs.symlinkSync('package.json',path.join(root,'alias'));assert.throws(()=>checkFacts({...data,claims:[{...data.claims[0],sources:['alias']}]},root),/symlink/);
 assert.throws(()=>checkFacts({...data,claims:[...data.claims,...data.claims]},root));
 for(const url of ['javascript:alert(1)','https://user:pass@example.com','https://example.com/ bad']) assert.throws(()=>checkFacts({...data,badges:[{label:'status',claim:'purpose',url}]},root));
}));
test('output root, exclusive file creation and bounded regular input hold with spaces',()=>fixture(root=>{
 const folder=path.join(root,'paths with spaces');fs.mkdirSync(folder);fs.writeFileSync(path.join(folder,'font'),'bytes');
 assert.equal(readRegular(path.join(folder,'font')).toString(),'bytes');assert.throws(()=>readRegular(path.join(folder,'font'),2));assert.throws(()=>readRegular(folder));
 writeFresh(folder,'title.svg','original');assert.throws(()=>writeFresh(folder,'title.svg','replacement'));assert.equal(fs.readFileSync(path.join(folder,'title.svg'),'utf8'),'original');
 fs.symlinkSync(folder,path.join(root,'link'));assert.throws(()=>writeFresh(root,'link/new.svg','escape'),/symlink/);assert.throws(()=>writeFresh(folder,'../escape.svg','escape'));
}));
test('shaping honors offsets, advances, whitespace and actual overhangs; hostile metadata is escaped',()=>{
 const font={unitsPerEm:1000,ascent:800,descent:-200,hasGlyphForCodePoint:()=>true,layout:()=>({glyphs:[{id:1,path:{toSVG:()=> 'M-200 0L1200 0L1200 900Z'},bbox:{minX:-200,maxX:1200,minY:0,maxY:900}},{id:2,path:{toSVG:()=>''}}],positions:[{xAdvance:1000,yAdvance:0,xOffset:50,yOffset:100},{xAdvance:300,yAdvance:0,xOffset:0,yOffset:0}]})};
 const svg=outline(font,'A <');assert.match(svg,/&lt;/);assert.match(svg,/translate\(50 100\)/);assert.match(svg,/viewBox="0 0 161 136"/);assert.doesNotMatch(svg,/<text|@font-face|href=/);
 assert.throws(()=>outline({...font,hasGlyphForCodePoint:()=>false},'A'),/missing glyph/);
 assert.throws(()=>outline(font,'A','url(evil)'));assert.throws(()=>outline(font,'A','#ffffff',NaN));
});

test('README assembly includes the researched decoration reference and structured cover slots',()=>{
 const skill=fs.readFileSync(new URL('../skills/readme-studio/SKILL.md',import.meta.url),'utf8');
 const reference=fs.readFileSync(new URL('../skills/readme-studio/references/decoration-patterns.md',import.meta.url),'utf8');
 const cover=fs.readFileSync(new URL('../skills/readme-studio/templates/readme-cover-section.md',import.meta.url),'utf8');
 assert.match(skill,/references\/decoration-patterns\.md/);
 for(const pattern of ['emoji section headers','centered hero','badge','iconography','<details>','contributors','star-history','showcase','feature grid','footer navigation','plain-Markdown']) assert.match(reference,new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'));
 for(const slot of ['Verified project title','Quick start','Features and demo','Optional verified badges','Footer navigation']) assert.match(cover,new RegExp(slot.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'));
});

test('design and README skills retain material interview answers across rounds',()=>{
 const frontendSkill=fs.readFileSync(new URL('../skills/frontend-ui-ux/SKILL.md',import.meta.url),'utf8');
 const frontendProduction=fs.readFileSync(new URL('../skills/frontend-ui-ux/references/production.md',import.meta.url),'utf8');
 const readmeSkill=fs.readFileSync(new URL('../skills/readme-studio/SKILL.md',import.meta.url),'utf8');
 const readmeProduction=fs.readFileSync(new URL('../skills/readme-studio/references/production.md',import.meta.url),'utf8');
 const manifest=JSON.parse(fs.readFileSync(new URL('../skills/managed-skill-manifest.json',import.meta.url),'utf8'));
 assert.match(frontendSkill,/references\/production\.md/i,'frontend entry must route to its decision guidance');
 assert.match(readmeSkill,/references\/production\.md/i,'README entry must route to its decision guidance');
 const rules=[
  /ask only when.{0,120}materially change/is,
  /one high-impact question per (?:turn|user turn)/i,
  /as many rounds as materially necessary/i,
  /(?:retain|record).{0,80}answers?.{0,80}across rounds/is,
  /(?:never|do not) re-ask.{0,80}settled/i,
  /bounded brief.{0,100}(?:default|assumption).{0,100}continue/is,
  /review-only and plan-only.{0,80}read-only/is,
 ];
 for(const [id,body] of [['frontend-ui-ux',frontendProduction],['readme-studio',readmeProduction]]){
  for(const rule of rules) assert.match(body,rule,`${id} production guidance must satisfy ${rule}`);
  const resource=manifest.skills[id].canonicalFiles.find((entry)=>entry.path==='references/production.md');
  assert.ok(resource,`${id} production reference must be installed as a managed resource`);
  assert.equal(resource.sha256,createHash('sha256').update(body).digest('hex'),`${id} production reference hash must match its managed manifest`);
 }
});

test('competing directions a brief leaves open get their own round instead of a default',()=>{
 const frontendSkill=fs.readFileSync(new URL('../skills/frontend-ui-ux/SKILL.md',import.meta.url),'utf8');
 const rules=[
  /names competing (?:visual )?directions.{0,160}(?:undecided|unresolved)/is,
  /acceptable.{0,120}not a (?:selection|choice) or (?:a )?delegation/is,
  /(?:its|their) own round/i,
  /(?:do not|never) announce a default.{0,80}(?:or|nor) (?:implement|build)/is,
  /no visual direction.{0,160}(?:default|pixel profile).{0,80}without asking/is,
  /default.{0,40}only.{0,120}(?:settles|resolves).{0,80}delegates/is,
 ];
 for(const rel of ['../skills/frontend-ui-ux/references/production.md','../skills/readme-studio/references/production.md']){
  const body=fs.readFileSync(new URL(rel,import.meta.url),'utf8');
  for(const rule of rules) assert.match(body,rule,`${rel} must satisfy ${rule}`);
 }
 assert.match(frontendSkill,/competing directions.{0,160}ask before (?:choosing|selecting)/is,'frontend entry must not default an open direction choice');
});

test('both cover templates stage depth planes and retain static rim lighting',()=>{
 const remotion=fs.readFileSync(new URL('../skills/readme-studio/templates/remotion/src/index.tsx',import.meta.url),'utf8');
 const hyperframes=fs.readFileSync(new URL('../skills/readme-studio/templates/hyperframes/index.html',import.meta.url),'utf8');
 for(const source of [remotion,hyperframes]){
  assert.match(source,/depth-plane-far/);
  assert.match(source,/depth-plane-middle/);
  assert.match(source,/sharp-foreground/);
  assert.match(source,/rim-light/);
 }
 assert.doesNotMatch(remotion,/rim-light[^\n]*useCurrentFrame/);
 assert.match(hyperframes,/@media \(prefers-reduced-motion: reduce\)/);
});

test('pixel illustration is the unsmoothed default anchor with a six pixel minimum cell',()=>{
 const profile=JSON.parse(fs.readFileSync(new URL('../skills/frontend-ui-ux/references/default-editorial-pixel.json',import.meta.url),'utf8'));
 assert.equal(profile.pixel_illustration.default_when_brief_unspecified,true);
 assert.equal(profile.pixel_illustration.primary_visual_anchor,'original task-specific pixel-art illustration');
 assert.equal(profile.pixel_illustration.minimum_rendered_cell_css_px,6);
 assert.equal(profile.pixel_illustration.rendering,'crisp non-smoothed');
});
