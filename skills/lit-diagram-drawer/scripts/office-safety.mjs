export function decodeXmlCharacterReferences(value) {
  try{
    const decoded=String(value).replace(/&#(?:x([0-9a-fA-F]+)|([0-9]+));/g,(_entity,hex,decimal)=>{
      const code=Number.parseInt(hex||decimal,hex?16:10);
      if(!Number.isInteger(code)||!(code===9||code===10||code===13||(code>=32&&code<=0xd7ff)||(code>=0xe000&&code<=0xfffd)||(code>=0x10000&&code<=0x10ffff)))throw new Error('invalid XML character reference');
      return String.fromCodePoint(code);
    });
    return decoded.includes('&#')?null:decoded;
  }catch{return null;}
}

export function markupStartTags(source) {
  const tags = [];
  for (let offset = 0; offset < source.length;) {
    const start = source.indexOf('<', offset);
    if (start < 0) break;
    if (!/[A-Za-z_:]/u.test(source[start + 1] ?? '')) { offset = start + 1; continue; }
    let quote = '';
    let end = start + 2;
    for (; end < source.length; end += 1) {
      const char = source[end];
      if (quote) { if (char === quote) quote = ''; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    if (end >= source.length) break;
    tags.push(source.slice(start, end + 1));
    offset = end + 1;
  }
  return tags;
}

export function markupTagName(tag) {
  return /^<\s*([A-Za-z_:][\w:.-]*)/u.exec(tag)?.[1].toLowerCase() ?? '';
}

export function markupAttributes(tag) {
  const attributes = [];
  let index = 1;
  while (/[A-Za-z_:]/u.test(tag[index] ?? '')) index += 1;
  while (index < tag.length) {
    while (/[\s/]/u.test(tag[index] ?? '')) index += 1;
    if (tag[index] === '>' || index >= tag.length) break;
    const start = index;
    while (index < tag.length && !/[\s/=>]/u.test(tag[index])) index += 1;
    if (index === start) { index += 1; continue; }
    const name = tag.slice(start, index).toLowerCase();
    while (/\s/u.test(tag[index] ?? '')) index += 1;
    let value = '';
    if (tag[index] === '=') {
      index += 1;
      while (/\s/u.test(tag[index] ?? '')) index += 1;
      const quote = tag[index] === '"' || tag[index] === "'" ? tag[index++] : '';
      const valueStart = index;
      if (quote) { while (index < tag.length && tag[index] !== quote) index += 1; }
      else { while (index < tag.length && !/[\s>]/u.test(tag[index])) index += 1; }
      value = tag.slice(valueStart, index);
      if (quote && tag[index] === quote) index += 1;
    }
    attributes.push({ name, value });
  }
  return attributes;
}

export function cssUrlsAreSafe(svg,{allowReference=(value)=>/^#[A-Za-z0-9_.:-]+$/.test(value)}={}) {
  if(decodeXmlCharacterReferences(svg)===null)return false;
  if(String(svg).includes('<!--'))return false;
  const source=String(svg);
  const cssParts=[...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map((match)=>match[1]);
  const tags=markupStartTags(source);
  const presentationNames=new Set(['fill','stroke','filter','mask','clip-path','marker-start','marker-mid','marker-end','cursor']);
  for(const tag of tags){
    for(const attribute of markupAttributes(tag)){
      if(attribute.name==='style'||presentationNames.has(attribute.name))cssParts.push(attribute.value);
    }
  }
  const decodedParts=cssParts.map((part)=>decodeXmlCharacterReferences(part.replace(/\/\*[\s\S]*?\*\//g,'')));
  if(decodedParts.some((part)=>part===null))return false;
  const cssSource=decodedParts.join('\n');
  if(cssSource.includes('\\')||/@import\b|\bvar\s*\(|\blocal\s*\(|\bunicode-range\s*:|(?:-webkit-)?image-set\s*\(|\bimage\s*\(|\bsrc\s*\(/i.test(cssSource)||decodedParts.some((part)=>part.includes('&')))return false;
  const url=/url\s*\(/ig;
  let match;
  while((match=url.exec(cssSource))){
    let quote=null,end=-1;
    for(let i=url.lastIndex;i<cssSource.length;i++){
      const char=cssSource[i];
      if(quote){if(char===quote)quote=null;continue;}
      if(char==='"'||char==="'"){quote=char;continue;}
      if(char==='(')return false;
      if(char===')'){end=i;break;}
    }
    if(end<0||quote)return false;
    let value=cssSource.slice(url.lastIndex,end).trim();
    if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1).trim();
    if(!allowReference(value))return false;
    url.lastIndex=end+1;
  }
  return true;
}

export function officeCssUrlsAreSafe(svg) {
  return cssUrlsAreSafe(svg);
}

export function officeHrefRefsAreSafe(svg) {
  if(decodeXmlCharacterReferences(svg)===null)return false;
  if(String(svg).includes('<!--'))return false;
  const source=String(svg);
  const tags=markupStartTags(source);
  for(const tag of tags){
    const decodedTag=decodeXmlCharacterReferences(tag);
    if(decodedTag===null)return false;
    if(markupTagName(decodedTag)==='base')return false;
    for(const {name,value} of markupAttributes(decodedTag)){
      if(name==='xml:base')return false;
      if(['href','src'].includes(name)&&!/^#[A-Za-z0-9_.:-]+$/u.test(value.trim()))return false;
    }
  }
  return true;
}
