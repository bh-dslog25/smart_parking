const { resolve, relative, isAbsolute } = require('node:path');
function validateRequest(base, path, body) {
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Invalid backend origin');
  if (typeof path !== 'string' || !/^\/api\/(?:health|auth\/(?:login|me|logout|users|forgot-password|verify-otp|verify-reset|reset-password|change-password|recovery-requests(?:\/[a-f0-9-]+\/review)?)|traffic\/intersections(?:\/[a-f0-9-]+\/(?:configure|history))?)$/.test(path)) throw new Error('Invalid API path');
  const payload = body === undefined ? undefined : JSON.stringify(body);
  if (payload && Buffer.byteLength(payload) > 8192) throw new Error('Request too large');
  return { url: url.origin + path, payload };
}
function assetPath(root, pathname) {
  const decoded = decodeURIComponent(pathname);
  const target = resolve(root, '.' + decoded);
  const rel = relative(root, target);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Invalid asset path');
  return target;
}
module.exports = { validateRequest, assetPath };
