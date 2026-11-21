import test from 'node:test';
import assert from 'node:assert/strict';
import readline from 'node:readline/promises';
import {PassThrough} from 'node:stream';
import {suspendReadline, isInterruptExit} from '../src/terminal.mjs';

test('child handoff releases raw mode and restores interactive readline', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const modes = [];
  input.isTTY = true;
  input.setRawMode = raw => { input.isRaw = raw; modes.push(raw); };
  const rl = readline.createInterface({input, output, terminal: true});
  try {
    assert.equal(input.isRaw, true);
    const restore = suspendReadline(rl, input);
    assert.equal(input.isRaw, false, 'Ctrl+C must generate a signal during child execution');
    assert.equal(input.isPaused(), true, 'parent must not consume child input');
    restore();
    restore();
    assert.deepEqual(modes, [true, false, true]);
    assert.equal(input.isPaused(), false);
    const answer = rl.question('next? ');
    input.write('ok\n');
    assert.equal(await answer, 'ok');
  } finally { rl.close(); }
});

test('non-terminal input and absent readline need no raw mode support', () => {
  const input = new PassThrough();
  const restore = suspendReadline(undefined, input);
  restore();
  restore();
  assert.equal(input.isRaw, undefined);
});

test('child interruption is recognised even before the parent signal handler', () => {
  for (const [code, signal] of [[null, 'SIGINT'], [null, 'SIGBREAK'], [130, null],
    [0xc000013a, null], [-1073741510, null]]) {
    assert.equal(isInterruptExit(code, signal), true);
  }
  for (const code of [null, 0, 1, 2]) assert.equal(isInterruptExit(code, null), false);
  assert.equal(isInterruptExit(null, 'SIGSEGV'), false);
});
