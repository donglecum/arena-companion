import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { responseBody } from '../src/respond.ts';

test('responseBody sends static files byte for byte', () => {
  // Not valid UTF-8: decoding these as text would replace them with U+FFFD.
  const bytes = Buffer.from([0x77, 0x4f, 0x46, 0x32, 0x00, 0xff, 0xc3, 0x28, 0x80]);
  assert.deepEqual(Buffer.from(responseBody(bytes, 'font/woff2')), bytes);
  // The bundled UI font is the file that was being corrupted.
  const font = fs.readFileSync('src/ui/fonts/inter-latin-wght.woff2');
  assert.ok(Buffer.from(responseBody(font, 'font/woff2')).equals(font));
});

test('responseBody encodes API answers as JSON and passes text through', () => {
  assert.equal(responseBody({ ok: true, n: 2 }, 'application/json'), '{"ok":true,"n":2}');
  assert.equal(responseBody(null, 'application/json'), 'null');
  assert.equal(responseBody('<svg/>', 'image/svg+xml'), '<svg/>');
});
