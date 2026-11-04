import test from 'node:test';
import assert from 'node:assert/strict';
import { embedParentOrigin } from '../src/embed.js';

test('embed height messages target the production blog or an explicit secure origin', () => {
  assert.equal(embedParentOrigin('?embed=1'), 'https://vipul.xyz');
  assert.equal(embedParentOrigin('?embed=1&parentOrigin=https%3A%2F%2Freview.onamp.dev'), 'https://review.onamp.dev');
  assert.equal(embedParentOrigin('?embed=1&parentOrigin=http%3A%2F%2Flocalhost%3A8080'), 'http://localhost:8080');
});

test('invalid parent origins disable height messages rather than using a wildcard', () => {
  for (const origin of ['', '*', 'null', 'javascript:alert(1)', 'https://example.com/path',
    'https://example.com/', 'https://user@example.com', 'http://example.com']) {
    assert.equal(embedParentOrigin(`?embed=1&parentOrigin=${encodeURIComponent(origin)}`), null, origin);
  }
});
