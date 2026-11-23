import assert from 'node:assert/strict';
import test from 'node:test';
import {FLIGHT_CONFIG as config, FLIGHT_STATE, sampleFlythrough} from '../flythrough.js';

test('flythrough starts from the exact inherited position and accelerates until it passes the core', () => {
  assert.equal(sampleFlythrough(-10).travel, 0);
  assert.deepEqual(sampleFlythrough(0), {
    travel: 0, controls: 1, glow: 0, radius: 14, overlay: 1,
    state: FLIGHT_STATE.ENTERING, done: false
  });
  assert.ok(sampleFlythrough(100).travel > .014, "The camera moves as soon as the gesture commits");
  let previous = 0;
  let previousStep = 0;
  for (let elapsed = 100; elapsed <= 2000; elapsed += 100) {
    const current = sampleFlythrough(elapsed).travel;
    assert.ok(current - previous > previousStep);
    previousStep = current - previous;
    previous = current;
  }
  assert.equal(sampleFlythrough(config.travelMs).travel, 1);
  assert.ok(config.pastCoreDistance > 0);
});

test('core glow builds before the homepage appears and the cover fades smoothly to zero', () => {
  assert.equal(sampleFlythrough(config.cloudMs).state, FLIGHT_STATE.TRANSITIONING);
  const reveal = sampleFlythrough(config.revealMs);
  assert.equal(reveal.overlay, 1);
  assert.ok(reveal.glow > .7);
  const midpoint = sampleFlythrough((config.revealMs + config.durationMs) / 2);
  assert.equal(midpoint.overlay, .5);
  assert.ok(midpoint.radius > reveal.radius);
  assert.equal(sampleFlythrough(config.durationMs).overlay, 0);
  assert.equal(sampleFlythrough(config.durationMs).done, true);
});
