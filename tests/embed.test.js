import test from 'node:test';
import assert from 'node:assert/strict';
import { embedParentOrigin } from '../src/embed.js';

test('embed height messages target the production blog or an explicit secure or local origin', () => {
  assert.equal(embedParentOrigin('?embed=1'), 'https://vipul.xyz');
  assert.equal(embedParentOrigin('?embed=1&parentOrigin=https%3A%2F%2Freview.onamp.dev'), 'https://review.onamp.dev');
  for (const origin of ['http://localhost:8080', 'http://127.0.0.1:3000', 'http://[::1]:3000',
    'http://192.168.1.7:3000', 'http://10.0.0.0', 'http://10.255.255.255',
    'http://172.16.0.0', 'http://172.31.255.255', 'http://192.168.0.0', 'http://192.168.255.255',
    'http://[fc00::]', 'http://[fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff]:3000']) {
    assert.equal(embedParentOrigin(`?embed=1&parentOrigin=${encodeURIComponent(origin)}`), origin, origin);
  }
});

test('invalid parent origins disable height messages rather than using a wildcard', () => {
  for (const origin of ['', '*', 'null', 'javascript:alert(1)', 'https://example.com/path',
    'https://example.com/', 'https://user@example.com', 'http://example.com',
    'http://9.255.255.255', 'http://11.0.0.0', 'http://172.15.255.255', 'http://172.32.0.0',
    'http://192.167.255.255', 'http://192.169.0.0', 'http://169.254.1.7', 'http://0.0.0.0',
    'http://224.0.0.1', 'http://[fbff:ffff:ffff:ffff:ffff:ffff:ffff:ffff]', 'http://[fe00::]',
    'http://[fe80::1]', 'http://[::]', 'http://[::ffff:c0a8:107]',
    'http://192.168.1.7:3000/', 'http://user@192.168.1.7:3000', 'http://192.168.1.7#fragment',
    'http://192.168.1.7?query=1', 'http://192.168.1.7:65536', 'http://192.168.1.256',
    'http://192.168.1', 'http://0xc0a80107', 'http://192.168.1.7.evil.example', 'http://10.foo.bar.baz',
    'ftp://192.168.1.7', '//192.168.1.7', 'http://[FD00::1]', 'http://[fd00:0:0:0:0:0:0:1]']) {
    assert.equal(embedParentOrigin(`?embed=1&parentOrigin=${encodeURIComponent(origin)}`), null, origin);
  }
});
