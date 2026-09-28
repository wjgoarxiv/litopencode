import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cssUrlsAreSafe, decodeXmlCharacterReferences, markupAttributes, markupStartTags, markupTagName, officeHrefRefsAreSafe } from './office-safety.mjs';

const BLOCKED_ELEMENTS = /<\s*(?:script|iframe|object|embed|foreignObject|link|applet|portal|frame|frameset|audio|video|source|track|image|animate(?:Motion|Transform)?|set|discard)\b/iu;
const EVENT_ATTRIBUTE = /^on[a-z][\w:.-]*$/iu;
const RESOURCE_ATTRIBUTES = new Set(['srcdoc','srcset','poster','background','manifest','codebase','archive','ping','profile']);

export function fontReferencePortable(value, sourceFile, fontFile) {
  if (/^#[A-Za-z][\w:.-]*$/u.test(value)) return true;
  if (/^data:font\/woff2;base64,[A-Za-z\d+/]*={0,2}$/iu.test(value)) return true;
  if (!sourceFile || !fontFile) return false;
  try {
    const skillRoot = path.resolve(fontFile, '../../..');
    const relativeSource = path.relative(skillRoot, path.resolve(sourceFile));
    if (relativeSource.startsWith(`..${path.sep}`) || relativeSource === '..' || path.isAbsolute(relativeSource)) return false;
    const target = new URL(value, pathToFileURL(path.resolve(sourceFile)));
    return target.protocol === 'file:' && !target.search && !target.hash
      && fs.realpathSync(fileURLToPath(target)) === fs.realpathSync(fontFile);
  } catch {
    return false;
  }
}

export function rendererSourceIssue(source, { sourceFile, fontFile } = {}) {
  const decoded = decodeXmlCharacterReferences(source);
  if (decoded === null) return 'invalid character references are unsupported';
  if (source.includes('<!--')) return 'HTML comment markup is unsupported during capture';
  const activeCheck = source;
  const declarationSource = activeCheck.replace(/<!doctype\s+html\s*>/giu, '');
  if (/<!DOCTYPE\b|<!ENTITY\b/iu.test(declarationSource)) return 'DTD and entity declarations are unsupported';
  if (declarationSource.replace(/^\uFEFF?\s*<\?xml\s+[^?]*\?>/iu, '').includes('<?')) return 'non-XML processing instructions are unsupported';
  const tags = markupStartTags(activeCheck)
    .map((tag) => decodeXmlCharacterReferences(tag) ?? tag);
  if (tags.some((tag) => BLOCKED_ELEMENTS.test(tag))) return 'active or resource-loading elements are unsupported';
  const attributes = tags.flatMap(markupAttributes);
  if (attributes.some(({name}) => EVENT_ATTRIBUTE.test(name))) return 'event-handler attributes are unsupported';
  if (attributes.some(({name}) => RESOURCE_ATTRIBUTES.has(name))) return 'resource-loading attributes are unsupported';
  if (tags.some((tag) => markupTagName(tag)==='meta' && markupAttributes(tag).some(({name,value})=>name==='http-equiv'&&value.trim().toLowerCase()==='refresh'))) return 'HTML refresh navigation is unsupported';
  if (!officeHrefRefsAreSafe(activeCheck)) return 'external or redirected href/src references are unsupported';
  if (!cssUrlsAreSafe(activeCheck, { allowReference: (value) => fontReferencePortable(value, sourceFile, fontFile) })) {
    return 'external, escaped, or active CSS resources are unsupported';
  }
  return null;
}
