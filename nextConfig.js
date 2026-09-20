const fs = require('fs');
const path = require('path');

const CONFIG_FILENAMES = ['next.config.ts', 'next.config.mjs', 'next.config.js'];

function findNextConfig(cwd) {
  for (const filename of CONFIG_FILENAMES) {
    const filePath = path.join(cwd, filename);
    if (fs.existsSync(filePath)) return filePath;
  }
  return null;
}

// Matches: allowedDevOrigins: [ ...items... ]  (single or double quoted strings only)
const ARRAY_FIELD_RE = /allowedDevOrigins\s*:\s*\[([^\]]*)\]/;

// Matches the object literal that gets exported, in either of the two
// conventional Next.js config shapes:
//   const nextConfig: NextConfig = { ... };  export default nextConfig;
//   module.exports = { ... };
const NAMED_OBJECT_RE = /((?:const|let|var)\s+\w+(?:\s*:\s*[\w.<>[\]]+)?\s*=\s*)\{([\s\S]*?)\n\}/;
const MODULE_EXPORTS_RE = /(module\.exports\s*=\s*)\{([\s\S]*?)\n\}/;

function addOriginToArraySource(arraySource, domain) {
  const existing = [...arraySource.matchAll(/["']([^"']+)["']/g)].map(m => m[1]);
  if (existing.includes(domain)) return null; // already present, nothing to do
  const trimmed = arraySource.trim();
  const sep = trimmed.length > 0 ? ', ' : '';
  return `${arraySource}${sep}"${domain}"`;
}

function injectIntoObjectBody(body, domain) {
  const arrayMatch = body.match(ARRAY_FIELD_RE);
  if (arrayMatch) {
    const newArrayInner = addOriginToArraySource(arrayMatch[1], domain);
    if (newArrayInner === null) return { body, changed: false };
    const newBody = body.replace(ARRAY_FIELD_RE, `allowedDevOrigins: [${newArrayInner}]`);
    return { body: newBody, changed: true };
  }

  // No allowedDevOrigins field yet — add one as the first property.
  const trimmedBody = body.replace(/^\s*\n/, '');
  const indentMatch = trimmedBody.match(/^(\s*)/);
  const indent = indentMatch ? indentMatch[1] : '  ';
  const newBody = `\n${indent}allowedDevOrigins: ["${domain}"],${body}`;
  return { body: newBody, changed: true };
}

// Returns { ok: true, changed } on success, or { ok: false, reason } when the
// file couldn't be safely modified (unrecognized shape) so the caller can
// tell the user to add it manually instead of risking corrupting their file.
function ensureAllowedDevOrigin(cwd, domain) {
  const configPath = findNextConfig(cwd);
  if (!configPath) {
    return { ok: false, reason: 'not_next_project' };
  }

  const source = fs.readFileSync(configPath, 'utf-8');

  let match = source.match(NAMED_OBJECT_RE);
  let re = NAMED_OBJECT_RE;
  if (!match) {
    match = source.match(MODULE_EXPORTS_RE);
    re = MODULE_EXPORTS_RE;
  }

  if (!match) {
    return {
      ok: false,
      reason: 'unrecognized_format',
      configPath,
      message: `Format ${path.basename(configPath)} tidak dikenali. Tambahkan manual: allowedDevOrigins: ["${domain}"]`,
    };
  }

  const [, prefix, body] = match;
  const { body: newBody, changed } = injectIntoObjectBody(body, domain);
  if (!changed) {
    return { ok: true, changed: false, configPath };
  }

  const newSource = source.replace(re, `${prefix}{${newBody}\n}`);
  fs.writeFileSync(configPath, newSource);
  return { ok: true, changed: true, configPath };
}

module.exports = { ensureAllowedDevOrigin, findNextConfig };
