import {test} from 'node:test';
import assert from 'node:assert/strict';
import {APPROACH_CONFIG as config, APPROACH_STATE as state, approachEndDistance,
  createGestureApproach, easeApproach} from '../gesture-approach.js';

const open = (ratio = 1) => ({type: 'OPEN_PALM', approachScale: .15 * ratio});
const fist = {type: 'FIST', approachScale: .15};
const other = {type: 'OTHER_HAND', approachScale: .15};
const feed = (machine, palm, start, end, progress = 0) => {
  for (let time = start; time <= end; time += 50) {
    machine.sample(palm, time, progress);
  }
};
function ready() {
  const machine = createGestureApproach();
  feed(machine, fist, 0, 500);
  feed(machine, open(), 550, 800);
  assert.equal(machine.state, state.PUSHING);
  return machine;
}

test('a normal open palm never activates zoom, and a fist needs 500 ms of detected hold time', () => {
  const machine = createGestureApproach();
  feed(machine, open(2), 0, 600);
  assert.equal(machine.state, state.EXPLORING);
  assert.equal(machine.target, 0);
  feed(machine, fist, 650, 1100);
  assert.equal(machine.state, state.FIST_CONFIRMING);
  machine.sample(open(), 1110, 0);
  assert.equal(machine.state, state.EXPLORING);
  feed(machine, fist, 1150, 1600);
  assert.equal(machine.state, state.FIST_CONFIRMING);
  machine.sample(fist, 1650, 0);
  assert.equal(machine.state, state.ARMED);
  assert.ok(machine.rotationLocked);
});

test('short uncertain frames pause fist confirmation without discarding the measured hold', () => {
  const machine = createGestureApproach();
  feed(machine, fist, 0, 400);
  machine.sample(other, 450, 0);
  machine.sample(null, 470, 0);
  machine.sample(fist, 500, 0);
  machine.sample(fist, 550, 0);
  assert.equal(machine.state, state.FIST_CONFIRMING);
  machine.sample(fist, 600, 0);
  assert.equal(machine.state, state.ARMED);
});

test('a longer interruption restarts fist confirmation', () => {
  const machine = createGestureApproach();
  feed(machine, fist, 0, 450);
  machine.sample(other, 520, 0);
  machine.sample(fist, 625, 0);
  assert.equal(machine.state, state.FIST_CONFIRMING);
  feed(machine, fist, 675, 1075);
  assert.equal(machine.state, state.FIST_CONFIRMING);
  machine.sample(fist, 1125, 0);
  assert.equal(machine.state, state.ARMED);
});

test('unstable palm scale delays calibration, then a 250 ms stable window arms pushing', () => {
  const machine = createGestureApproach();
  feed(machine, fist, 0, 500);
  for (let time = 550; time <= 900; time += 50) machine.sample(open(time % 100 ? 1.3 : 1), time, 0);
  assert.equal(machine.state, state.PALM_OPEN);
  feed(machine, open(1.1), 950, 1200);
  assert.equal(machine.state, state.PUSHING);
  assert.equal(machine.target, 0);
});

test('zoom has a dead zone, rejects an isolated scale jump, and reverses smoothly from the stop', () => {
  const machine = ready();
  feed(machine, open(1.025), 850, 1150);
  assert.equal(machine.target, 0);
  machine.sample(open(config.fullRatio), 1200, 0);
  assert.equal(machine.target, 0);
  machine.sample(open(), 1250, 0);
  assert.equal(machine.target, 0);
  for (let time = 1300; time <= 1450; time += 50) {
    const previous = machine.target;
    machine.sample(open(1.2 + (time - 1300) * .0025), time, 0);
    assert.ok(machine.target - previous <= config.maxProgressPerSecond * .05 + 1e-8);
  }
  assert.ok(machine.target > .1);
  feed(machine, open(config.fullRatio), 1500, 2800);
  assert.equal(machine.target, 1);
  assert.equal(machine.state, state.PUSHING);
  feed(machine, open(), 2850, 4200, 1);
  assert.equal(machine.target, 0);
  assert.equal(machine.state, state.PUSHING);
});

test('brief pose misclassification preserves the reference so a small forward movement is still counted', () => {
  const machine = ready();
  machine.sample(other, 850, 0);
  assert.equal(machine.target, 0);
  feed(machine, open(1.05), 900, 1350);
  assert.ok(machine.target > .03);
  feed(machine, open(1.15), 1400, 1850);
  assert.ok(machine.target > .25);
});

test('a sustained pose change requires a new distance sample without moving the camera', () => {
  const machine = ready();
  feed(machine, open(1.15), 850, 1250);
  const held = machine.target;
  feed(machine, other, 1300, 1700, held);
  feed(machine, open(1.4), 1750, 2050, held);
  assert.ok(Math.abs(machine.target - held) < 1e-10);
});

test('brief loss freezes rendered progress and reacquisition never jumps to the new hand scale', () => {
  const machine = ready();
  feed(machine, open(1.32), 850, 1600);
  const held = machine.target * .75;
  machine.sample(null, 1650, held);
  assert.equal(machine.target, held);
  machine.sample(open(1.55), 1900, held);
  assert.equal(machine.target, held);
  feed(machine, open(1.55), 1950, 2150, held);
  assert.ok(Math.abs(machine.target - held) < 1e-10);
  machine.sample(null, 3650, held);
  assert.equal(machine.state, state.RETURNING);
  assert.equal(machine.target, 0);
  machine.finishReturn();
  assert.equal(machine.state, state.EXPLORING);
  assert.equal(machine.rotationLocked, false);
});

test('a held second fist cancels and cannot immediately start another attempt', () => {
  const machine = ready();
  feed(machine, fist, 850, 1150, .4);
  assert.equal(machine.state, state.PUSHING);
  machine.sample(fist, 1200, .4);
  assert.equal(machine.state, state.RETURNING);
  assert.equal(machine.target, 0);
  machine.finishReturn();
  feed(machine, fist, 1250, 2000);
  assert.equal(machine.state, state.EXPLORING);
  machine.sample(open(), 2050, 0);
  feed(machine, fist, 2100, 2600);
  assert.equal(machine.state, state.ARMED);
});

test('camera progress settles monotonically at an entrance strictly in front of the core', () => {
  for (const start of [19.8, 22.6, 56]) {
    const end = approachEndDistance(start);
    assert.ok(end < start && end >= config.minCameraDistance);
  }
  let rendered = easeApproach(0, 1, 1 / 60);
  assert.ok(rendered > 0 && rendered < 1);
  for (let frame = 0; frame < 120; frame++) rendered = easeApproach(rendered, 1, 1 / 60);
  assert.equal(rendered, 1);
  rendered = easeApproach(rendered, 0, 1 / 60);
  assert.ok(rendered > 0 && rendered < 1);
  for (let frame = 0; frame < 120; frame++) rendered = easeApproach(rendered, 0, 1 / 60);
  assert.equal(rendered, 0);
});
