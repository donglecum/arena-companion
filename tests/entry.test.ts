import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isEntryPoint } from '../src/entry.ts';

const file = path.resolve('src/checklist.ts');

test('isEntryPoint matches a module URL to the argv path on this OS', () => {
  // On Windows argv[1] is "C:\\...\\checklist.ts" and the URL is "file:///C:/...":
  // a string comparison never matches, a path comparison does.
  assert.equal(isEntryPoint(pathToFileURL(file).href, file), true);
});

test('isEntryPoint is false for other modules or no argv', () => {
  assert.equal(isEntryPoint(pathToFileURL(file).href, path.resolve('src/server.ts')), false);
  assert.equal(isEntryPoint(pathToFileURL(file).href, undefined), false);
});
