import test from 'node:test';
import assert from 'node:assert/strict';
import {openHandTracker} from '../hand-landmarker.js';

test('cold-cache worker initialization can exceed the old eight-second limit', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const original = Object.fromEntries(['Worker','createImageBitmap','OffscreenCanvas'].map(key => [key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  let worker;
  globalThis.Worker = class {
    constructor() {worker=this;setTimeout(() => this.onmessage?.({data:{ok:true}}),9000);}
    terminate() {this.terminated=true;}
  };
  globalThis.createImageBitmap = () => {};
  globalThis.OffscreenCanvas = class {};
  const abort = new AbortController();
  try {
    const pending = openHandTracker(abort.signal);
    t.mock.timers.tick(9000);
    const tracker = await pending;
    assert.equal(tracker.mode,'worker');
    assert.ok(!worker.terminated);
    tracker.close();
    assert.ok(worker.terminated);
  } finally {
    abort.abort();
    for (const [key,descriptor] of Object.entries(original)) {
      if (descriptor) Object.defineProperty(globalThis,key,descriptor);
      else delete globalThis[key];
    }
  }
});

test('a stuck cold start stays bounded without restarting downloads on the main thread', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const original = Object.fromEntries(['Worker','createImageBitmap','OffscreenCanvas'].map(key => [key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  let worker;
  globalThis.Worker = class { constructor(){worker=this;} terminate(){this.terminated=true;} };
  globalThis.createImageBitmap = () => {};
  globalThis.OffscreenCanvas = class {};
  const abort = new AbortController();
  try {
    const pending = openHandTracker(abort.signal);
    const rejected = assert.rejects(pending,{name:'TimeoutError'});
    t.mock.timers.tick(105000);
    await rejected;
    assert.ok(worker.terminated);
  } finally {
    abort.abort();
    for (const [key,descriptor] of Object.entries(original)) {
      if (descriptor) Object.defineProperty(globalThis,key,descriptor);
      else delete globalThis[key];
    }
  }
});
