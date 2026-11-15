const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { validateRequest, assetPath } = require('./policy.cjs');
test('native bridge confines calls to known API endpoints and root backend addresses', () => {
  assert.equal(validateRequest('http://localhost:3000', '/api/auth/login', { email: 'operator@example.com' }).url, 'http://localhost:3000/api/auth/login');
  assert.equal(validateRequest('https://traffic.example.com', '/api/traffic/intersections/abcd-1234/history').payload, undefined);
  for (const base of ['file:///C:/private', 'http://user:pass@localhost', 'https://example.com/api', 'https://example.com/?next=other']) assert.throws(() => validateRequest(base, '/api/health'));
  for (const route of ['//evil.example/api/health', '/api/auth/login?redirect=other', '/api/../private', '/private']) assert.throws(() => validateRequest('http://localhost:3000', route));
  assert.throws(() => validateRequest('http://localhost:3000', '/api/auth/login', { data: 'x'.repeat(9000) }));
});
test('packaged asset handler rejects encoded traversal', () => {
  const root = path.resolve('ui');
  assert.equal(assetPath(root, '/assets/app.js'), path.join(root, 'assets', 'app.js'));
  assert.throws(() => assetPath(root, '/%2e%2e/private'));
  assert.throws(() => assetPath(root, '/%2e%2e%5cprivate'));
});
