import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isJsonContentType, isLoopbackHost, isLoopbackOrigin, rejectRequest } from '../src/httpGuard.ts';

const PORT = 8788;

test('isLoopbackHost accepts loopback names on our port only', () => {
  assert.equal(isLoopbackHost('localhost:8788', PORT), true);
  assert.equal(isLoopbackHost('127.0.0.1:8788', PORT), true);
  assert.equal(isLoopbackHost('[::1]:8788', PORT), true);
  assert.equal(isLoopbackHost('LOCALHOST:8788', PORT), true);
  assert.equal(isLoopbackHost('localhost', PORT), false); // implies port 80
  assert.equal(isLoopbackHost('localhost:9999', PORT), false);
  assert.equal(isLoopbackHost('evil.example:8788', PORT), false); // DNS rebinding
  assert.equal(isLoopbackHost('192.168.1.20:8788', PORT), false);
  assert.equal(isLoopbackHost(undefined, PORT), false);
});

test('isLoopbackOrigin accepts only this server as an origin', () => {
  assert.equal(isLoopbackOrigin('http://localhost:8788', PORT), true);
  assert.equal(isLoopbackOrigin('http://127.0.0.1:8788', PORT), true);
  assert.equal(isLoopbackOrigin('https://localhost:8788', PORT), false);
  assert.equal(isLoopbackOrigin('http://localhost:3000', PORT), false);
  assert.equal(isLoopbackOrigin('https://evil.example', PORT), false);
  assert.equal(isLoopbackOrigin('null', PORT), false);
});

test('rejectRequest blocks foreign hosts and cross-site writes', () => {
  const ok = { host: 'localhost:8788' };
  assert.equal(rejectRequest({ method: 'GET', headers: ok }, PORT), null);
  assert.equal(rejectRequest({ method: 'GET', headers: { host: 'evil.example:8788' } }, PORT), 'forbidden host');
  // A page on another site POSTing to localhost: the browser sends its Origin.
  assert.equal(
    rejectRequest({ method: 'POST', headers: { ...ok, origin: 'https://evil.example' } }, PORT),
    'forbidden origin',
  );
  assert.equal(rejectRequest({ method: 'DELETE', headers: { ...ok, origin: 'null' } }, PORT), 'forbidden origin');
  // Our own UI, and non-browser local clients (no Origin), may write.
  assert.equal(rejectRequest({ method: 'POST', headers: { ...ok, origin: 'http://localhost:8788' } }, PORT), null);
  assert.equal(rejectRequest({ method: 'POST', headers: ok }, PORT), null);
});

test('isJsonContentType requires application/json', () => {
  assert.equal(isJsonContentType('application/json'), true);
  assert.equal(isJsonContentType('application/json; charset=utf-8'), true);
  assert.equal(isJsonContentType('text/plain'), false); // no-preflight cross-site form
  assert.equal(isJsonContentType(undefined), false);
});
