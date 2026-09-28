import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {readRegular, writeFresh} from './files.mjs';
const xml = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const finite = values => { if (!values.every(Number.isFinite)) throw new Error('invalid finite glyph geometry'); };

export function outline(font, text, fill = '#15242a', size = 100) {
  if (typeof text !== 'string' || !text.trim() || [...text].length > 500 || /[\x00-\x1f]/u.test(text) || !/^#[a-f0-9]{6}$/i.test(fill) || !Number.isFinite(size) || size <= 0 || size > 512) throw new Error('invalid text, size or fill');
  finite([font.unitsPerEm,font.ascent,font.descent]);
  if (font.unitsPerEm <= 0 || font.ascent <= font.descent) throw new Error('invalid font metrics');
  for (const c of text) if (!font.hasGlyphForCodePoint(c.codePointAt(0))) throw new Error(`missing glyph U+${c.codePointAt(0).toString(16)}`);
  const run = font.layout(text);
  if (!run.glyphs.length || run.glyphs.length !== run.positions.length) throw new Error('invalid shaped run');
  let x=0,y=0,minX=0,maxX=0,minY=font.descent,maxY=font.ascent;
  const paths=[];
  run.glyphs.forEach((glyph,i) => {
    const p=run.positions[i];finite([p.xAdvance,p.yAdvance,p.xOffset,p.yOffset]);
    if (!glyph.id) throw new Error('missing shaped glyph');
    const d=glyph.path.toSVG();
    if (typeof d !== 'string') throw new Error('missing outline');
    const gx=x+p.xOffset, gy=y+p.yOffset;
    if (d) {
      const b=glyph.bbox;finite([b.minX,b.maxX,b.minY,b.maxY]);
      if(b.minX>b.maxX || b.minY>b.maxY) throw new Error('invalid glyph bounds');
      minX=Math.min(minX,gx+b.minX);maxX=Math.max(maxX,gx+b.maxX);
      minY=Math.min(minY,gy+b.minY);maxY=Math.max(maxY,gy+b.maxY);
      paths.push(`<path d="${xml(d)}" transform="translate(${gx} ${gy})"/>`);
    }
    x+=p.xAdvance;y+=p.yAdvance;finite([x,y]);minX=Math.min(minX,x);maxX=Math.max(maxX,x);
  });
  const scale=size/font.unitsPerEm,pad=size*.08,width=(maxX-minX)*scale+pad*2,height=(maxY-minY)*scale+pad*2;
  finite([width,height]);if(width<=0 || height<=0) throw new Error('invalid bounds');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img"><title>${xml(text)}</title><g fill="${fill}" transform="translate(${pad-minX*scale} ${pad+maxY*scale}) scale(${scale} ${-scale})">${paths.join('')}</g></svg>\n`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const {values:v}=parseArgs({options:Object.fromEntries(['font','family','license','text','root','output','fill','size'].map(k=>[k,{type:'string'}]))});
    for(const key of ['font','family','license','text','root','output']) if(!v[key]) throw new Error(`--${key} required`);
    const bytes=readRegular(v.font,64*1048576), license=readRegular(v.license);
    const font=(await import('fontkit')).create(bytes);
    if(font.familyName !== v.family) throw new Error(`font family mismatch: ${font.familyName}`);
    const svg=outline(font,v.text,v.fill, v.size === undefined ? 100 : Number(v.size));
    const output=writeFresh(v.root,v.output,svg);
    console.log(JSON.stringify({output,text:v.text,font:{family:font.familyName,style:font.subfamilyName,version:font.version,sha256:createHash('sha256').update(bytes).digest('hex')},license:{path:v.license,sha256:createHash('sha256').update(license).digest('hex'),review:'manual license verification required'}}));
  } catch(error) {console.error(`readme-studio: ${error.message}`);process.exitCode=1;}
}
