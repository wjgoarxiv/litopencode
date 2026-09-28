import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { officeCssUrlsAreSafe, officeHrefRefsAreSafe } from './office-safety.mjs';

assert.equal(officeCssUrlsAreSafe('<svg><path fill="url(#arrow-main)"/></svg>'),true);
assert.equal(officeCssUrlsAreSafe('<svg><style>.x{filter:url( #shadow )}</style></svg>'),true);
assert.equal(officeCssUrlsAreSafe('<svg><path fill="url(&#35;arrow-main)"/></svg>'),true);
assert.equal(officeCssUrlsAreSafe('<svg data-note="<style>"><img style="background:url(file:///tmp/a)"/></style></svg>'),false,'style-like attribute text cannot hide CSS-bearing markup');
for(const value of [
  'file:///tmp/payload.svg',
  'ftp://example.invalid/payload.svg',
  '//example.invalid/payload.svg',
  'https://example.invalid/payload.svg',
  '../payload.svg',
  'data:image/svg+xml;base64,AAAA'
]){
  assert.equal(officeCssUrlsAreSafe('<svg><style>.x{fill:url("'+value+'")}</style></svg>'),false,value);
}
assert.equal(officeCssUrlsAreSafe('<svg><style>.x{fill:u/**/rl(file:///tmp/a)}</style></svg>'),false);
assert.equal(officeCssUrlsAreSafe('<svg><style>.x{fill:u\\72l(file:///tmp/a)}</style></svg>'),false);
assert.equal(officeCssUrlsAreSafe('<svg><style>.x{fill:u&#114;l(file:///tmp/a)}</style></svg>'),false,'decimal XML reference in CSS function name');
assert.equal(officeCssUrlsAreSafe('<svg><style>.x{fill:u&#x72;l(https://example.invalid/a)}</style></svg>'),false,'hex XML reference in CSS function name');
assert.equal(officeCssUrlsAreSafe('<svg><style>&#64;import "file:///tmp/a.css";</style></svg>'),false,'numeric XML reference in CSS at-rule');
assert.equal(officeCssUrlsAreSafe('<svg><path style="&commat;import url(file:///tmp/a.css)"/></svg>'),false,'named HTML reference in CSS attribute');
assert.equal(officeCssUrlsAreSafe('<svg><style>.x{fill:v&#97;r(--external)}</style></svg>'),false,'numeric XML reference in unsupported var() function');
assert.equal(officeCssUrlsAreSafe('<svg><style>@font-face{font-family:Pretendard;src:local(Arial)}</style></svg>'),false,'local() cannot spoof the bundled font face');
assert.equal(officeCssUrlsAreSafe('<svg><style>@font-face{font-family:Pretendard;src:url(font.woff2);unicode-range:U+0020}</style></svg>'),false,'unicode-range cannot make partial font coverage appear complete');
assert.equal(officeCssUrlsAreSafe('<svg><style>.x{fill:url(file:///tmp/a}</style></svg>'),false);
assert.equal(officeHrefRefsAreSafe('<svg><use href="#local-symbol"/></svg>'),true);
for(const reference of ['file:///tmp/a.svg','ftp://example.invalid/a.svg','//example.invalid/a.svg','../a.svg','https://example.invalid/a.svg','&#102;ile:///tmp/a.svg']){
  assert.equal(officeHrefRefsAreSafe('<svg><image href="'+reference+'"/></svg>'),false,reference);
}
assert.equal(officeHrefRefsAreSafe('<svg><image href=file:///tmp/a.svg/></svg>'),false);
assert.equal(officeHrefRefsAreSafe('<svg><image href="&#35;local-symbol"/></svg>'),true);
assert.equal(officeHrefRefsAreSafe('<svg data-note="<style>"><img src="https://example.invalid/x"/></style></svg>'),false,'style-like attribute text cannot hide resource references');
assert.equal(officeHrefRefsAreSafe('<svg><image href="https&colon;&sol;&sol;example.invalid/a.svg"/></svg>'),false,'named HTML references cannot disguise an external URI');
assert.equal(officeHrefRefsAreSafe('<svg xml:base="https://example.invalid/a.svg"><use href="#local-symbol"/></svg>'),false,'xml:base cannot redirect a fragment reference');
assert.equal(officeHrefRefsAreSafe('<html><head><base href="https://example.invalid/"></head><svg><use href="#local-symbol"/></svg></html>'),false,'HTML base cannot redirect a fragment reference');

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'lit-diagram-office-guard-'));
const exporter=path.join(root,'scripts/export.mjs');
const cliFixtures=[
  ['css-import','<svg viewBox="0 0 10 10"><style>&#64;import "file:///tmp/a.css";</style></svg>'],
  ['css-var','<svg viewBox="0 0 10 10"><style>.x{fill:v&#97;r(--external)}</style></svg>'],
  ['css-local-font','<svg viewBox="0 0 10 10"><style>@font-face{font-family:Pretendard;src:local(Arial)}</style></svg>'],
  ['css-font-unicode-range','<svg viewBox="0 0 10 10"><style>@font-face{font-family:Pretendard;src:url(font.woff2);unicode-range:U+0020}</style></svg>'],
  ['css-url','<svg viewBox="0 0 10 10"><style>.x{fill:u&#114;l(https://example.invalid/a)}</style></svg>'],
  ['xml-base','<svg viewBox="0 0 10 10" xml:base="https://example.invalid/"><use href="#local-symbol"/></svg>']
];
try{
  for(const [name,svg] of cliFixtures){
    const input=path.join(temp,name+'.svg'),output=path.join(temp,name+'-out');
    fs.writeFileSync(input,svg);
    const result=spawnSync(process.execPath,[exporter,'--input',input,'--out',output,'--scale','1','--office-safe'],{encoding:'utf8'});
    assert.equal(result.status,2,name+' must fail before output');
    assert.match(result.stderr,/EXPORT_SOURCE_REJECTED|OFFICE_UNSAFE|OFFICE_UNSUPPORTED/,name);
    assert.equal(fs.existsSync(output),false,name+' must not create output');
  }
}finally{
  fs.rmSync(temp,{recursive:true,force:true});
}
console.log('Office guard passed local-fragment cases and rejected encoded external CSS, unsupported var(), partial-font unicode ranges, unsafe bases, and malformed href/src references in both helper and exporter fixtures.');
