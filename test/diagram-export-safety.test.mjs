import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { inspectDiagramCapabilities } from '../skills/lit-diagram-drawer/scripts/capability-probe.mjs';
import { rendererSourceIssue } from '../skills/lit-diagram-drawer/scripts/renderer-safety.mjs';

const skillRoot=path.resolve('skills/lit-diagram-drawer');
const fontFile=path.join(skillRoot,'assets/fonts/PretendardVariable.woff2');
const exporter=path.join(skillRoot,'scripts/export.mjs');

function withTempDirectory(callback){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lit-diagram-export-safety-'));
  try{return callback(directory);}
  finally{fs.rmSync(directory,{recursive:true,force:true});}
}

function writeDriver(bin,marker,version){
  const file=path.join(bin,'agent-browser');
  const quotedMarker="'"+marker.replaceAll("'","'\\''")+"'";
  fs.writeFileSync(file,`#!/bin/sh\nprintf '%s\\n' "$*" >> ${quotedMarker}\ncase "$1" in\n  --version) printf 'agent-browser ${version}\\n' ;;\n  doctor) printf '%s\\n' '{"success":true,"checks":[{"id":"chrome.installed","message":"Chrome for Testing 154.0.0"}]}' ;;\n  *) exit 0 ;;\nesac\n`);
  fs.chmodSync(file,0o755);
}

function writeInstallSentinels(bin,marker){
  const quotedMarker="'"+marker.replaceAll("'","'\\''")+"'";
  for(const command of ['npm','npx']){
    const file=path.join(bin,command);
    fs.writeFileSync(file,`#!/bin/sh\nprintf '%s\\n' '${command} $*' >> ${quotedMarker}\nexit 97\n`);
    fs.chmodSync(file,0o755);
  }
}

test('renderer preflight accepts packaged self-contained sources and rejects active or external content',()=>{
  const accepted=fs.readFileSync(path.join(skillRoot,'examples/07-deployment-boundary/after.html'),'utf8');
  assert.equal(rendererSourceIssue(accepted,{sourceFile:path.join(skillRoot,'examples/07-deployment-boundary/after.html'),fontFile}),null);
  assert.equal(rendererSourceIssue('<svg viewBox="0 0 10 10"><defs><marker id="a"/></defs><path marker-end="url(#a)"/></svg>'),null);
  assert.equal(rendererSourceIssue('<style>@font-face{src:url(data:font/woff2;base64,AA==)}</style><svg/>'),null);
  assert.equal(rendererSourceIssue('<svg><text>C:\\data\\input @import var(--safe) unicode-range: url(https://example.invalid/plain-text) style="background:url(https://example.invalid/x)" href="https://example.invalid/x" onload="alert(1)" srcdoc="&lt;script&gt;"</text></svg>'),null,'technical labels are not parsed as markup attributes or CSS');
  assert.equal(rendererSourceIssue('<?xml version="1.0"?><svg viewBox="0 0 1 1"/>'),null,'a leading XML declaration remains supported');

  const cases=[
    ['inline script','<svg><script>alert(1)</script></svg>','active or resource-loading elements'],
    ['event handler','<svg onload="alert(1)"/>','event-handler attributes'],
    ['foreign document','<svg><foreignObject><iframe src="https://example.invalid"/></foreignObject></svg>','active or resource-loading elements'],
    ['external image','<img src="https://example.invalid/pixel.png"><svg/>','external or redirected href/src'],
    ['encoded external href','<svg><use href="https&colon;//example.invalid/a.svg#x"/></svg>','external or redirected href/src'],
    ['base redirect','<base href="https://example.invalid/"><svg/>','external or redirected href/src'],
    ['slash-separated event attribute','<svg/onload="alert(1)" viewBox="0 0 10 10"></svg>','event-handler attributes'],
    ['slash-separated background resource','<body/background="https://example.invalid/x"><svg/></body>','resource-loading attributes'],
    ['slash-separated manifest resource','<html/manifest="https://example.invalid/x"><svg/></html>','resource-loading attributes'],
    ['encoded refresh value','<meta http-equiv="ref&#114;esh" content="0;url=https://example.invalid"><svg/>','HTML refresh navigation'],
    ['external stylesheet processing instruction','<?xml-stylesheet type="text/css" href="https://example.invalid/evil.css"?><svg/>','processing instructions'],
    ['doctype entity declaration','<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg/>','DTD and entity declarations'],
    ['CSS import','<style>@import "https://example.invalid/a.css";</style><svg/>','external, escaped, or active CSS'],
    ['CSS import hidden by comment tokens','<style><!-- @import "https://example.invalid/a.css"; --></style><svg/>','HTML comment markup is unsupported'],
    ['CSS URL hidden by comment tokens','<style><!-- .x{background:url(https://example.invalid/x.png)} --></style><svg/>','HTML comment markup is unsupported'],
    ['alternate comment terminator','<!-- --!><script>fetch("https://example.invalid")</script> --><svg/>','HTML comment markup is unsupported'],
    ['empty comment terminator','<!--><script>fetch("https://example.invalid")</script>--><svg/>','HTML comment markup is unsupported'],
    ['short comment terminator','<!---!><script>fetch("https://example.invalid")</script>--><svg/>','HTML comment markup is unsupported'],
    ['style token in quoted attribute does not hide script','<svg data-note="<style>"><script>fetch("https://example.invalid")</script></style><svg viewBox="0 0 1 1"></svg></svg>','active or resource-loading elements'],
    ['style token in quoted attribute does not hide image','<div title="<style>"><img src="https://example.invalid/x"></style><svg viewBox="0 0 1 1"></svg></div>','external or redirected href/src'],
    ['style token in textarea does not hide script','<textarea><style></textarea><script>fetch("https://example.invalid")</script></style><svg viewBox="0 0 1 1"></svg>','active or resource-loading elements'],
    ['style token in title does not hide image','<title><style></title><img src="https://example.invalid/x"></style><svg viewBox="0 0 1 1"></svg>','external or redirected href/src'],
    ['CSS image-set string URL','<style>.x{background-image:image-set("https://example.invalid/x.png" 1x)}</style><svg/>','external, escaped, or active CSS'],
    ['CSS prefixed image-set string URL','<style>.x{background-image:-webkit-image-set("https://example.invalid/x.png" 1x)}</style><svg/>','external, escaped, or active CSS'],
    ['SMIL href mutation','<svg><use id="x" href="#safe"/><animate href="#x" attributeName="href" to="https://example.invalid/a.svg#x"/></svg>','active or resource-loading elements'],
    ['SMIL set href mutation','<svg><a id="x" href="#safe"><text>open</text></a><set href="#x" attributeName="href" to="https://example.invalid/"/></svg>','active or resource-loading elements'],
    ['SMIL discard','<svg><g id="x"/><discard href="#x" begin="0s"/></svg>','active or resource-loading elements'],
    ['CSS image string URL','<style>.x{background-image:image("https://example.invalid/x.png")}</style><svg/>','external, escaped, or active CSS'],
    ['CSS cross-fade image string URL','<style>.x{background-image:cross-fade(image("https://example.invalid/x.png"),linear-gradient(red,blue),50%)}</style><svg/>','external, escaped, or active CSS'],
    ['CSS src string URL','<style>@font-face{src:src("https://example.invalid/font.woff2")}</style><svg/>','external, escaped, or active CSS'],
    ['external CSS URL','<style>svg{background:url(file:///private/data)}</style><svg/>','external, escaped, or active CSS'],
    ['outside font file','<style>@font-face{src:url(../../private/font.woff2)}</style><svg/>','external, escaped, or active CSS'],
    ['HTML refresh','<meta http-equiv="refresh" content="0;url=https://example.invalid"><svg/>','HTML refresh navigation'],
    ['srcdoc','<div srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></div><svg/>','resource-loading attributes']
  ];
  for(const [name,source,expected] of cases) assert.match(rendererSourceIssue(source,{sourceFile:'/tmp/diagram.html',fontFile}),new RegExp(expected),name);
});

test('an exported project diagram cannot depend on the temporary installed skill font',()=>withTempDirectory((directory)=>{
  const sourceFile=path.join(directory,'diagram.html');
  const fontReference=path.relative(directory,fontFile);
  const source=`<style>@font-face{font-family:Pretendard;src:url(${fontReference}) format("woff2")}</style><svg/>`;
  fs.writeFileSync(sourceFile,source);
  assert.match(rendererSourceIssue(source,{sourceFile,fontFile}),/external, escaped, or active CSS resources/u);
}));

test('unsafe export fixtures stop before driver invocation and output creation',()=>withTempDirectory((directory)=>{
  const bin=path.join(directory,'bin');fs.mkdirSync(bin);
  const marker=path.join(directory,'driver-calls.log');writeDriver(bin,marker,'0.38.1');
  writeInstallSentinels(bin,marker);
  const hostile=[
    '<svg viewBox="0 0 10 10"><script>fetch("https://example.invalid")</script></svg>',
    '<html><body onload="alert(1)"><svg viewBox="0 0 10 10"/></body></html>',
    '<html><style>@import "https://example.invalid/evil.css";</style><svg viewBox="0 0 10 10"/></html>',
    '<style><!-- @import "https://example.invalid/a.css"; --></style><svg viewBox="0 0 10 10"/>',
    '<style><!-- .x{background:url(https://example.invalid/x.png)} --></style><svg class="x" viewBox="0 0 10 10"/>',
    '<!-- --!><script>fetch("https://example.invalid")</script> --><svg viewBox="0 0 10 10"/>',
    '<svg data-note="<style>"><script>fetch("https://example.invalid")</script></style><svg viewBox="0 0 10 10"></svg></svg>',
    '<div title="<style>"><img src="https://example.invalid/x"></style><svg viewBox="0 0 10 10"></svg></div>',
    '<textarea><style></textarea><script>fetch("https://example.invalid")</script></style><svg viewBox="0 0 10 10"></svg>',
    '<title><style></title><img src="https://example.invalid/x"></style><svg viewBox="0 0 10 10"></svg>',
    '<svg viewBox="0 0 10 10"><image href="file:///private/secret.png"/></svg>',
    '<html><head><base href="https://example.invalid/"></head><svg viewBox="0 0 10 10"/></html>',
    '<svg/onload="alert(1)" viewBox="0 0 10 10"></svg>',
    '<body/background="https://example.invalid/x"><svg viewBox="0 0 10 10"/></body>',
    '<html/manifest="https://example.invalid/x"><svg viewBox="0 0 10 10"/></html>',
    '<meta http-equiv="ref&#114;esh" content="0;url=https://example.invalid"><svg viewBox="0 0 10 10"/>',
    '<?xml-stylesheet type="text/css" href="https://example.invalid/evil.css"?><svg viewBox="0 0 10 10"/>',
    '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg viewBox="0 0 10 10"/>',
    '<html><style>.x{background-image:image-set("https://example.invalid/x.png" 1x)}</style><svg viewBox="0 0 10 10"/></html>',
    '<svg viewBox="0 0 10 10"><use id="x" href="#safe"/><animate href="#x" attributeName="href" to="https://example.invalid/a.svg#x"/></svg>',
    '<svg viewBox="0 0 10 10"><a id="x" href="#safe"><text>open</text></a><set href="#x" attributeName="href" to="https://example.invalid/"/></svg>',
    '<svg viewBox="0 0 10 10"><g id="x"/><discard href="#x" begin="0s"/></svg>',
    '<style>.x{background-image:image("https://example.invalid/x.png")}</style><svg viewBox="0 0 10 10"/>',
    '<style>.x{background-image:cross-fade(image("https://example.invalid/x.png"),linear-gradient(red,blue),50%)}</style><svg viewBox="0 0 10 10"/>',
    '<style>@font-face{src:src("https://example.invalid/font.woff2")}</style><svg viewBox="0 0 10 10"/>'
  ];
  for(const [index,source] of hostile.entries()){
    const input=path.join(directory,`hostile-${index}.html`),output=path.join(directory,`output-${index}`);
    fs.writeFileSync(input,source);
    const result=spawnSync(process.execPath,[exporter,'--input',input,'--out',output,'--scale','1'],{encoding:'utf8',env:{...process.env,PATH:bin},timeout:30_000});
    assert.equal(result.status,2,result.stderr);
    assert.match(result.stderr,/EXPORT_SOURCE_REJECTED/u);
    assert.doesNotMatch(result.stderr,/npm install|agent-browser install/u);
    assert.equal(fs.existsSync(output),false,'rejected source must not create export output');
    assert.equal(fs.existsSync(marker),false,'rejected source must not invoke agent-browser');
  }
}));

test('export encodes reserved filename characters in the browser file URL',()=>withTempDirectory((directory)=>{
  const bin=path.join(directory,'bin');fs.mkdirSync(bin);
  const marker=path.join(directory,'driver-calls.log');
  writeInstallSentinels(bin,marker);
  const quotedMarker="'"+marker.replaceAll("'","'\\''")+"'";
  const driver=path.join(bin,'agent-browser');
  fs.writeFileSync(driver,`#!/bin/sh\nprintf '%s\\n' "$*" >> ${quotedMarker}\nif [ "$1" = "--version" ]; then printf 'agent-browser 0.38.1\\n'; exit 0; fi\nif [ "$1" = "doctor" ]; then printf '%s\\n' '{"success":true,"checks":[{"id":"chrome.installed","message":"Chrome for Testing 154.0.0"}]}' ; exit 0; fi\ncase "$3" in\n  eval) printf '%s\\n' '{"width":10,"height":10,"x":0,"y":0,"viewportWidth":640,"viewportHeight":480,"font":true}' ;;\n  screenshot) printf 'PNG-stub' > "$5" ;;\nesac\n`);
  fs.chmodSync(driver,0o755);
  const input=path.join(directory,'diagram # 100%.svg');
  const output=path.join(directory,'exports');
  fs.writeFileSync(input,'<svg viewBox="0 0 10 10"><text>Safe</text></svg>');
  const result=spawnSync(process.execPath,[exporter,'--input',input,'--out',output,'--scale','1'],{encoding:'utf8',env:{...process.env,PATH:bin},timeout:30_000});
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.equal(fs.statSync(path.join(output,'diagram # 100%-1x.png')).size,8);
  const openLine=fs.readFileSync(marker,'utf8').split(/\r?\n/u).find((line)=>line.includes(' open '));
  assert.ok(openLine?.endsWith(' open '+pathToFileURL(input).href),openLine);
}));

test('capability probe honors missing, below-floor, minimum, and newer renderer states without installation',()=>withTempDirectory((directory)=>{
  const bin=path.join(directory,'bin');fs.mkdirSync(bin);
  const marker=path.join(directory,'driver-calls.log');
  const originalPath=process.env.PATH;
  writeInstallSentinels(bin,marker);
  process.env.PATH=bin;
  try{
    const missing=inspectDiagramCapabilities();
    assert.equal(missing.ready,false);
    assert.equal(missing.checks.find((check)=>check.id==='agent-browser').status,'fail');
    assert.equal(fs.existsSync(marker),false,'a missing driver is not installed or invoked');

    writeDriver(bin,marker,'0.38.0');
    const below=inspectDiagramCapabilities();
    assert.equal(below.ready,false);
    assert.equal(below.checks.find((check)=>check.id==='agent-browser').status,'fail');
    assert.match(below.checks.find((check)=>check.id==='agent-browser').detail,/older than required floor 0\.38\.1/u);
    assert.doesNotMatch(fs.readFileSync(marker,'utf8'),/doctor/u,'a below-floor driver is rejected before its doctor command');
    assert.doesNotMatch(fs.readFileSync(marker,'utf8'),/\b(?:npm|npx)\b|install/u,'missing and below-floor renderer probes never install tools');

    for(const version of ['0.38.1','0.39.0']){
      fs.writeFileSync(marker,'');writeDriver(bin,marker,version);
      const report=inspectDiagramCapabilities();
      assert.equal(report.ready,true,version);
      assert.equal(report.checks.find((check)=>check.id==='agent-browser').status,'pass',version);
      assert.equal(report.checks.find((check)=>check.id==='pretendard-license').status,'pass',version);
      assert.match(fs.readFileSync(marker,'utf8'),/doctor --json/u,version+' doctor probe runs');
    }

    const safe=path.join(directory,'safe.svg'),output=path.join(directory,'missing-driver-output');
    fs.writeFileSync(safe,'<svg viewBox="0 0 10 10"><text>Safe</text></svg>');
    process.env.PATH=path.join(directory,'empty-path');fs.mkdirSync(process.env.PATH);
    fs.writeFileSync(marker,'');writeInstallSentinels(process.env.PATH,marker);
    const blocked=spawnSync(process.execPath,[exporter,'--input',safe,'--out',output,'--scale','1'],{encoding:'utf8',env:{...process.env,PATH:process.env.PATH},timeout:30_000});
    assert.equal(blocked.status,2,blocked.stderr);
    assert.match(blocked.stderr,/EXPORT_CAPABILITY_BLOCKED/u);
    assert.match(blocked.stderr,/npm install -g agent-browser@0\.38\.1 && agent-browser install/u);
    assert.equal(fs.readFileSync(marker,'utf8'),'','missing renderer prints setup without running package/browser install commands');
    assert.equal(fs.existsSync(output),false,'missing capability does not mutate the destination');
    const writeFailure=inspectDiagramCapabilities({writeDirectory:safe});
    assert.equal(writeFailure.ready,false);
    assert.match(writeFailure.checks.find((check)=>check.id==='write-access').detail,/write access unavailable/u);
    const outputNotDirectory=spawnSync(process.execPath,[exporter,'--input',safe,'--out',safe,'--scale','1'],{encoding:'utf8',env:{...process.env,PATH:process.env.PATH},timeout:30_000});
    assert.equal(outputNotDirectory.status,2,outputNotDirectory.stderr);
    assert.match(outputNotDirectory.stderr,/EXPORT_CAPABILITY_BLOCKED .*write-access: write access unavailable/u);
    const doctor=spawnSync(process.execPath,[path.join(skillRoot,'scripts/doctor.mjs'),'--out',safe],{encoding:'utf8',env:{...process.env,PATH:process.env.PATH},timeout:30_000});
    assert.equal(doctor.status,1,doctor.stderr);
    assert.match(JSON.parse(doctor.stdout).checks.find((check)=>check.id==='write-access').detail,/write access unavailable/u);
  }finally{
    if(originalPath===undefined)delete process.env.PATH;else process.env.PATH=originalPath;
  }
}));
