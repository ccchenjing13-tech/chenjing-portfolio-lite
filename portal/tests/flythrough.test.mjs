import assert from 'node:assert/strict';
import test from 'node:test';
import {createEntranceHold, FLIGHT_CONFIG as config, FLIGHT_STATE, sampleFlythrough} from '../flythrough.js';

test('entrance needs a stable threshold on rendered and target progress while the hand is present', () => {
  const ready = createEntranceHold();
  assert.equal(ready(0, true, .979, 1), false);
  assert.equal(ready(20, true, 1, .979), false);
  assert.equal(ready(100, true, .98, 1), false);
  assert.equal(ready(399, true, .988, 1), false);
  assert.equal(ready(400, true, 1, 1), true);
  assert.equal(ready(420, false, 1, 1), false);
  assert.equal(ready(700, true, 1, 1), false);
  assert.equal(ready(999, true, 1, 1), false);
  assert.equal(ready(1000, true, 1, 1), true);
});

test('a slower tracker may confirm the dwell, but a gap with no fresh sample resets it', () => {
  const ready = createEntranceHold();
  assert.equal(ready(0, true, 1, 1), false);
  assert.equal(ready(360, true, 1, 1), true);
  assert.equal(ready(1000, true, 1, 1), false);
  assert.equal(ready(1299, true, 1, 1), false);
  assert.equal(ready(1300, true, 1, 1), true);
});

test('flythrough starts from the exact inherited position and accelerates until it passes the core', () => {
  assert.equal(sampleFlythrough(-10).travel, 0);
  assert.deepEqual(sampleFlythrough(0), {
    travel: 0, controls: 1, glow: 0, radius: 14, overlay: 1,
    state: FLIGHT_STATE.ENTERING, done: false
  });
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
