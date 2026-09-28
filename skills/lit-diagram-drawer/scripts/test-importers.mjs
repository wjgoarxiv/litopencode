import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'lit-diagram-importer-'));
const importers=[
  {name:'draw.io',script:'drawio-extract.mjs',extension:'.drawio',limit:16*1024*1024,valid:'<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="Input" vertex="1" parent="1"/></root></mxGraphModel>'},
  {name:'Mermaid',script:'mermaid-extract.mjs',extension:'.mmd',limit:4*1024*1024,valid:'flowchart LR\nA[Input] --> B[Store]\n'},
  {name:'Excalidraw',script:'excalidraw-extract.mjs',extension:'.excalidraw',limit:16*1024*1024,valid:JSON.stringify({type:'excalidraw',elements:[{id:'a',type:'rectangle',x:0,y:0,width:80,height:30}]})}
];
function run(importer,file,...args){
  return spawnSync(process.execPath,[path.join(root,'scripts',importer.script),file,...args],{encoding:'utf8',timeout:30_000,maxBuffer:1024*1024});
}
try{
  for(const importer of importers){
    const valid=path.join(temp,'valid'+importer.extension);
    fs.writeFileSync(valid,importer.valid);
    const accepted=run(importer,valid);
    assert.equal(accepted.status,0,importer.name+' valid fixture: '+accepted.stderr);
    assert.equal(JSON.parse(accepted.stdout).schemaVersion,1,importer.name+' emits the normalized schema');

    let encodedActive,encodedUrl;
    if(importer.name==='draw.io'){
      encodedActive=importer.valid.replace('value="Input"','value="&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;"');
      encodedUrl=importer.valid.replace('value="Input"','value="https&amp;#58;//example.invalid/path"');
    }else if(importer.name==='Mermaid'){
      encodedActive='flowchart LR\nA["&lt;script&gt;alert(1)&lt;/script&gt;"] --> B[Store]\n';
      encodedUrl='flowchart LR\nA["https&#58;//example.invalid/path"] --> B[Store]\n';
    }else{
      const scene=JSON.parse(importer.valid);
      scene.elements.push({id:'label',type:'text',text:'&lt;script&gt;alert(1)&lt;/script&gt;',x:0,y:0,width:80,height:20,containerId:'a'});
      encodedActive=JSON.stringify(scene);
      scene.elements.at(-1).text='https&#58;//example.invalid/path';
      encodedUrl=JSON.stringify(scene);
    }
    const activeFile=path.join(temp,'encoded-active'+importer.extension);
    fs.writeFileSync(activeFile,encodedActive);
    const encodedAttack=run(importer,activeFile);
    assert.equal(encodedAttack.status,2,importer.name+' entity-encoded active markup is rejected');
    assert.match(encodedAttack.stderr,/executable markup/u,importer.name+' identifies unsafe encoded markup');

    const urlFile=path.join(temp,'encoded-url'+importer.extension);
    fs.writeFileSync(urlFile,encodedUrl);
    const urlResult=run(importer,urlFile);
    assert.equal(urlResult.status,0,importer.name+' encoded URL is safely discarded: '+urlResult.stderr);
    const urlOutput=JSON.parse(urlResult.stdout);
    assert.equal(urlOutput.discarded.urls,1,importer.name+' accounts for its discarded encoded URL');
    assert.doesNotMatch(JSON.stringify({title:urlOutput.title,nodes:urlOutput.nodes,relationships:urlOutput.relationships,groups:urlOutput.groups}),/example\.invalid/u,importer.name+' does not preserve the encoded URL');

    const oversized=path.join(temp,'oversized'+importer.extension);
    const oversizedFd=fs.openSync(oversized,'w');
    fs.ftruncateSync(oversizedFd,importer.limit+1);
    fs.closeSync(oversizedFd);
    const tooLarge=run(importer,oversized);
    assert.equal(tooLarge.status,2,importer.name+' oversized source is rejected');
    assert.match(tooLarge.stderr,/exceeds the \d+ MiB limit/u,importer.name+' reports its size bound');

    const symlink=path.join(temp,'linked'+importer.extension);
    try { fs.symlinkSync(valid,symlink); }
    catch(error){
      if(!['EACCES','EPERM','ENOTSUP','EOPNOTSUPP'].includes(error.code)) throw error;
      continue;
    }
    const linked=run(importer,symlink);
    assert.equal(linked.status,2,importer.name+' symlink source is rejected');
    assert.match(linked.stderr,/regular file|safely read/u,importer.name+' explains the no-follow boundary');
  }
  const drawio=importers[0];
  const bomb=deflateRawSync(Buffer.alloc(32*1024*1024+1)).toString('base64');
  const selectedPage=path.join(temp,'selected-page.drawio');
  fs.writeFileSync(selectedPage,`<mxfile><diagram name="selected">${drawio.valid}</diagram><diagram>${bomb}</diagram><diagram>${bomb}</diagram></mxfile>`);
  const selected=run(drawio,selectedPage,'--page','0');
  assert.equal(selected.status,0,'unselected compressed pages are never inflated: '+selected.stderr);
  assert.equal(JSON.parse(selected.stdout).title,'selected');

  const unsafeTitle=path.join(temp,'unsafe-title.drawio');
  fs.writeFileSync(unsafeTitle,`<mxfile><diagram name="&lt;script&gt;alert(1)&lt;/script&gt;">${drawio.valid}</diagram></mxfile>`);
  const unsafeTitleResult=run(drawio,unsafeTitle);
  assert.equal(unsafeTitleResult.status,2,'encoded active markup in a page name is rejected');
  assert.match(unsafeTitleResult.stderr,/executable markup/u);

  const urlTitle=path.join(temp,'url-title.drawio');
  fs.writeFileSync(urlTitle,`<mxfile><diagram name="https://example.invalid/path">${drawio.valid}</diagram></mxfile>`);
  const normalizedTitle=run(drawio,urlTitle);
  assert.equal(normalizedTitle.status,0,normalizedTitle.stderr);
  assert.equal(JSON.parse(normalizedTitle.stdout).title,'Imported diagram');
  assert.equal(JSON.parse(normalizedTitle.stdout).discarded.urls,1,'URL-bearing page titles are accounted as discarded content');

  for(const [importer,filename] of [[importers[1],'evil<script>.mmd'],[importers[2],'evil<script>.excalidraw']]){
    const maliciousName=path.join(temp,filename);
    fs.writeFileSync(maliciousName,importer.valid);
    const rejectedName=run(importer,maliciousName);
    assert.equal(rejectedName.status,2,importer.name+' malicious fallback filename is rejected');
    assert.match(rejectedName.stderr,/executable markup/u);
  }
  for(const [importer,filename] of [[importers[1],'https&#58;example.invalid.mmd'],[importers[2],'https&#58;example.invalid.excalidraw']]){
    const urlName=path.join(temp,filename);
    fs.writeFileSync(urlName,importer.valid);
    const cleanedName=run(importer,urlName);
    assert.equal(cleanedName.status,0,cleanedName.stderr);
    const normalized=JSON.parse(cleanedName.stdout);
    assert.equal(normalized.title,'Imported diagram',importer.name+' uses a nonempty fallback after filename URL removal');
    assert.equal(normalized.discarded.urls,1,importer.name+' accounts for the URL in its fallback filename');
  }

  const oversizedPage=path.join(temp,'oversized-page.drawio');
  fs.writeFileSync(oversizedPage,`<mxfile><diagram>${bomb}</diagram></mxfile>`);
  const oversizedSelected=run(drawio,oversizedPage,'--page','0');
  assert.equal(oversizedSelected.status,2,'selected compressed page beyond decoded limit is rejected');
  assert.match(oversizedSelected.stderr,/invalid or oversized compression/u);
}finally{
  fs.rmSync(temp,{recursive:true,force:true});
}
console.log('IMPORTER_GUARDS_PASS draw.io Mermaid Excalidraw bounded stable regular-file no-follow reads');
