import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLockfile, redactLockfile } from '../src/lockfile.ts';

const SAMPLE = 'LeagueClient:24376:54321:s3cr3t-t0ken:https';

test('parses standard lockfile format', () => {
  const lf = parseLockfile(SAMPLE);
  assert.equal(lf.name, 'LeagueClient');
  assert.equal(lf.pid, 24376);
  assert.equal(lf.port, 54321);
  assert.equal(lf.password, 's3cr3t-t0ken');
  assert.equal(lf.protocol, 'https');
});

test('handles trailing newline and CRLF', () => {
  const lf = parseLockfile(SAMPLE + '\r\n');
  assert.equal(lf.port, 54321);
  assert.equal(lf.protocol, 'https');
});

test('rejects malformed lockfile', () => {
  assert.throws(() => parseLockfile('garbage'), /lockfile/i);
  assert.throws(() => parseLockfile('a:b:c'), /lockfile/i);
  assert.throws(() => parseLockfile(''), /lockfile/i);
});

test('rejects non-numeric pid/port', () => {
  assert.throws(() => parseLockfile('LeagueClient:abc:54321:pw:https'), /lockfile/i);
});

test('redactLockfile hides the password but keeps diagnostics', () => {
  const redacted = redactLockfile(SAMPLE);
  assert.ok(!redacted.includes('s3cr3t-t0ken'));
  assert.ok(redacted.includes('54321'));
  assert.ok(redacted.includes('LeagueClient'));
});
