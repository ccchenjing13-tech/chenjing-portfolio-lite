import {test} from 'node:test';
import assert from 'node:assert/strict';
import {APPROACH_STATE as state, createGestureApproach} from '../gesture-approach.js';

const open = (ratio = 1, x = .5) => ({type: 'OPEN_PALM', x, approachScale: .15 * ratio});
const fist = {type: 'FIST', approachScale: .15};
const softFist = {...fist, fistConfidence: 'soft'};
const other = {type: 'OTHER_HAND', approachScale: .15};

test('a quick clear fist, opening and pushing can commit on the next forward sample', () => {
  const machine = createGestureApproach();
  assert.equal(machine.sample(fist, 0), false);
  assert.equal(machine.state, state.ARMED);
  assert.equal(machine.sample(open(), 45), false);
  assert.equal(machine.state, state.PALM_OPEN);
  assert.equal(machine.sample(open(1.13), 90), true);
  assert.equal(machine.state, state.COMMITTED);
  machine.reset();
  assert.equal(machine.sample(null, 150), false);
  assert.equal(machine.sample(open(.94), 200), false);
  assert.equal(machine.state, state.COMMITTED);
});

test('continuous opening and pushing is recognized even if the first open sample is already closer', () => {
  const machine = createGestureApproach();
  machine.sample(fist, 0);
  machine.sample(open(1.17), 70);
  assert.equal(machine.sample(open(1.24), 105), true);
});

test('a soft fist needs another brief sample before it can arm', () => {
  const machine = createGestureApproach();
  machine.sample(softFist, 0);
  machine.sample(softFist, 30);
  assert.equal(machine.state, state.FIST_SEEN);
  machine.sample(open(), 60);
  assert.equal(machine.sample(open(1.2), 85), false);
  machine.sample(softFist, 100);
  machine.sample(softFist, 150);
  assert.equal(machine.state, state.ARMED);
  machine.sample(open(), 180);
  assert.equal(machine.sample(open(1.16), 215), true);
});

test('ordinary rotation, opening a fist in place and a single big landmark spike do not enter', () => {
  const machine = createGestureApproach();
  assert.equal(machine.sample(open(1.28, .3), 0), false);
  assert.equal(machine.sample(open(1.68, .7), 30), false);
  machine.sample(fist, 60);
  assert.equal(machine.sample(open(1.30), 100), false);
  assert.equal(machine.sample(open(1.31), 130), false);
  assert.equal(machine.sample(open(1.75), 160), false);
  assert.equal(machine.sample(open(1.3), 190), false);
  assert.equal(machine.state, state.PALM_OPEN);
});

test('a sustained fast push passes the check for a single large landmark jump', () => {
  const machine = createGestureApproach();
  machine.sample(fist, 0);
  machine.sample(open(), 40);
  assert.equal(machine.sample(open(1.34), 80), false);
  assert.equal(machine.sample(open(1.35), 110), true);
});

test('a widening palm with no additional height cannot qualify as a forward push', () => {
  const machine = createGestureApproach();
  machine.sample(fist, 0);
  machine.sample(open(), 30);
  assert.equal(machine.sample({...open(1.17), palmWidth: .20, palmHeight: .15}, 70), false);
});

test('a short tracking dropout is tolerated, but losing tracking or waiting requires another fist', () => {
  const quick = createGestureApproach();
  quick.sample(fist, 0);
  quick.sample(other, 40);
  quick.sample(open(), 70);
  quick.sample(null, 110);
  assert.equal(quick.sample(open(1.14), 170), true);
  const canceled = createGestureApproach();
  canceled.sample(fist, 0);
  canceled.sample(open(), 50);
  canceled.sample(null, 160);
  assert.equal(canceled.sample(open(1.24), 380), false);
  assert.equal(canceled.state, state.EXPLORING);
  canceled.sample(fist, 400);
  canceled.sample(open(), 450);
  for (let time = 550; time <= 1950; time += 100) canceled.sample(open(), time);
  assert.equal(canceled.sample(open(1.3), 1980), false);
  assert.equal(canceled.state, state.EXPLORING);
});

test('a relaxed palm with a small forward movement still enters after a fist', () => {
  const machine = createGestureApproach();
  machine.sample(fist, 0);
  machine.sample(open(), 42);
  assert.equal(machine.sample({...open(1.09), type: 'OTHER_HAND', loosePalm: true}, 85), true);
});

test('occlusion while opening does not discard a confirmed fist', () => {
  const machine = createGestureApproach();
  machine.sample(fist, 0);
  machine.sample(null, 80);
  machine.sample(other, 200);
  machine.sample(open(), 320);
  assert.equal(machine.sample(open(1.09), 365), true);
});
