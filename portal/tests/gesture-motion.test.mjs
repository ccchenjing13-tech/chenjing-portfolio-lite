import assert from 'node:assert/strict';
import test from 'node:test';
import {createGestureMotion, describePalm, GESTURE_CONFIG} from '../gesture-motion.js';
import {Quaternion, Vector3} from '../vendor/three-r180/three.module.min.js';
import {createGalaxyRotation} from '../galaxy-rotation.js';

const palm = (x, y = 0.5) => ({x, y, scale: 0.15, type: 'OPEN_PALM'});

function samples(motion, coordinates, from = 0, enabled = true) {
  return coordinates.map((x, index) => motion.sample(palm(x), from + index * 50, enabled).yaw);
}

test('selfie movement follows the same yaw direction as dragging', () => {
  for (const mirrored of [true, false]) {
    const motion = createGestureMotion({...GESTURE_CONFIG, mirrored});
    const turns = samples(motion, [0.6, 0.6, 0.6, 0.57, 0.53, 0.49]);
    assert.ok(turns.slice(0, 3).every(yaw => yaw === 0));
    assert.equal(Math.sign(turns.at(-1)), mirrored ? 1 : -1);
    assert.ok(turns.every(yaw => Math.abs(yaw) <= GESTURE_CONFIG.maxRadiansPerSecond * 0.05));
  }
});

test('stationary hand and small landmark noise leave the last angle alone', () => {
  const motion = createGestureMotion();
  const noise = Array.from({length: 60}, (_, i) => 0.94 + (i % 2 ? 0.003 : -0.003));
  assert.ok(samples(motion, noise).every(yaw => yaw === 0));
});

test('tracking loss, large jumps and manual input discard the previous position', () => {
  const motion = createGestureMotion();
  samples(motion, [0.6, 0.6, 0.6, 0.56]);
  assert.equal(motion.sample(palm(0.2), 200, true).yaw, 0);
  assert.equal(motion.sample(null, 250, true).gesture.type, 'NO_HAND');
  assert.ok(samples(motion, [0.85, 0.85, 0.85, 0.85], 300).every(yaw => yaw === 0));
  assert.ok(samples(motion, [0.8, 0.75, 0.7], 500, false).every(yaw => yaw === 0));
  assert.equal(motion.sample(palm(0.66), 650, true).yaw, 0);
  assert.equal(motion.sample(palm(0.62), 1100, true).yaw, 0);
});

test('an input ending leaves the smoothed rotation at its last target', () => {
  const rotation = createGalaxyRotation(new Quaternion());
  rotation.turn(0.24, 0);
  rotation.update(1 / 60);
  assert.ok(rotation.orientation.angleTo(new Quaternion()) < 0.24);
  for (let i = 0; i < 90; i++) rotation.update(1 / 60);
  const settled = rotation.orientation.clone();
  for (let i = 0; i < 90; i++) rotation.update(1 / 60);
  assert.ok(settled.angleTo(rotation.orientation) < 1e-6);
  assert.ok(Math.abs(settled.angleTo(new Quaternion()) - 0.24) < 1e-6);
});

test('palm scale uses the knuckles and wrist, and curled fingers classify as a fist', () => {
  const landmarks = Array.from({length: 21}, () => ({x: .5, y: .6, z: 0}));
  landmarks[0].y = 0.75;
  for (const [base, joint, tip, x] of [[5, 6, 8, .41], [9, 10, 12, .47], [13, 14, 16, .53], [17, 18, 20, .59]]) {
    landmarks[base] = {x, y: 0.59, z: 0};
    landmarks[joint] = {x, y: 0.50, z: 0};
    landmarks[tip] = {x, y: 0.43, z: 0};
  }
  const openPalm = describePalm(landmarks);
  assert.equal(openPalm.type, 'OPEN_PALM');
  assert.ok(Math.abs(openPalm.y - (0.75 + 4 * 0.59) / 5) < 1e-10);
  assert.ok(openPalm.approachScale > 0);
  for (const index of [8, 12]) landmarks[index].y = 0.54;
  assert.equal(describePalm(landmarks).type, 'OTHER_HAND');
  for (const index of [8, 12, 16, 20]) landmarks[index].y = 0.54;
  assert.equal(describePalm(landmarks).type, 'FIST');
  assert.equal(describePalm(landmarks).approachScale, openPalm.approachScale);
  // The thumb can sit outside a fist, and the curled fingertips may be offset in depth.
  landmarks[4] = {x: .33, y: .51, z: -.04};
  for (const index of [8, 12, 16, 20]) landmarks[index].z = .12;
  assert.equal(describePalm(landmarks).type, 'FIST');
  landmarks[8] = {x: .41, y: .43, z: 0};
  assert.equal(describePalm(landmarks).type, 'OTHER_HAND');
  assert.equal(describePalm(landmarks.slice(1)), null);
});

const xAxis = new Vector3(1, 0, 0);
const yAxis = new Vector3(0, 1, 0);
const angle = (axis, radians) => new Quaternion().setFromAxisAngle(axis, radians);
const settle = rotation => { for (let i = 0; i < 100; i++) rotation.update(1 / 60); };
const samePose = (a, b) => assert.ok(a.angleTo(b) < 1e-6);

test('vertical direction is not mirrored and horizontal input stays independent', () => {
  for (const mirrored of [false, true]) {
    const config = {...GESTURE_CONFIG, mirrored};
    const diagonal = createGestureMotion(config);
    const horizontal = createGestureMotion(config);
    const vertical = createGestureMotion(config);
    for (let i = 0; i < 4; i++) {
      for (const tracker of [diagonal, horizontal, vertical]) tracker.sample(palm(.5), i * 50, true);
    }
    const up = diagonal.sample(palm(.46, .46), 200, true);
    const sideways = horizontal.sample(palm(.46), 200, true);
    assert.equal(up.yaw, sideways.yaw);
    assert.equal(sideways.pitch, 0);
    assert.equal(up.pitch, vertical.sample(palm(.5,.46), 200, true).pitch);
    assert.ok(up.pitch < 0);
    assert.ok(diagonal.sample(palm(.5, .56), 250, true).pitch > 0);
  }
});

test('vertical jitter and a lost, interrupted or implausibly large motion produce no pitch jumps', () => {
  const motion = createGestureMotion();
  for (let i = 0; i < 30; i++) {
    assert.ok(motion.sample(palm(.5, .5 + (i % 2 ? .003 : -.003)), i * 50, true).pitch === 0);
  }
  const fast = motion.sample(palm(.5, .69), 1500, true);
  assert.ok(fast.pitch > 0 && fast.pitch <= GESTURE_CONFIG.maxRadiansPerSecond * .05);
  const outlier = motion.sample(palm(.42, .18), 1550, true);
  assert.equal(outlier.pitch, 0);
  assert.notEqual(outlier.yaw, 0);
  motion.sample(null, 1600, true);
  for (let i = 0; i < 5; i++) assert.equal(motion.sample(palm(.5,.84), 1650+i*50, true).pitch, 0);
  assert.equal(motion.sample(palm(.5,.72), 1900, false).pitch, 0);
  assert.equal(motion.sample(palm(.5,.60), 1950, true).pitch, 0);
});

test('yaw stays identical without pitch and combines with a stable screen-horizontal pitch axis', () => {
  const home = angle(xAxis, -1.15);
  const rotation = createGalaxyRotation(home);
  const originalYaw = createGalaxyRotation(home);
  for (const yaw of [.04, .52, -.47, .18]) {
    rotation.turnGesture(yaw, 0, -.35, Math.PI / 4);
    originalYaw.turn(yaw, 0);
    for (let i = 0; i < 8; i++) {
      rotation.update(1 / 60);
      originalYaw.update(1 / 60);
      assert.deepEqual(rotation.orientation.toArray(), originalYaw.orientation.toArray());
    }
  }
  rotation.turnGesture(.84, .4, -.35, Math.PI / 4);
  originalYaw.turn(.84, 0);
  settle(rotation);
  settle(originalYaw);
  samePose(rotation.orientation, originalYaw.orientation.clone().premultiply(angle(xAxis,.4)));
});

test('gesture pitch eases to both limits, can reverse immediately, and holds without resetting', () => {
  const min = -.35, max = Math.PI / 4;
  const rotation = createGalaxyRotation(new Quaternion());
  rotation.turnGesture(0, 2, min, max);
  rotation.update(1 / 60);
  assert.ok(rotation.orientation.angleTo(new Quaternion()) < max);
  settle(rotation);
  samePose(rotation.orientation, angle(xAxis,max));
  for (let i = 0; i < 10; i++) {
    rotation.turnGesture(0, .3, min, max);
    rotation.update(1 / 60);
    samePose(rotation.orientation, angle(xAxis,max));
  }
  rotation.hold();
  rotation.turnGesture(0, .3, min, max);
  settle(rotation);
  samePose(rotation.orientation, angle(xAxis,max));
  rotation.turnGesture(0, -.1, min, max);
  settle(rotation);
  samePose(rotation.orientation, angle(xAxis,max - .1));
  rotation.turnGesture(0, -2, min, max);
  settle(rotation);
  samePose(rotation.orientation, angle(xAxis,min));
  settle(rotation);
  samePose(rotation.orientation, angle(xAxis,min));
});

test('mouse rotation still applies its original screen-space step after a hand tilt', () => {
  const rotation = createGalaxyRotation(new Quaternion());
  rotation.turnGesture(0, .35, -.35, Math.PI / 4);
  settle(rotation);
  rotation.hold();
  const before = rotation.orientation.clone();
  rotation.turn(.6, 0);
  settle(rotation);
  samePose(rotation.orientation, before.premultiply(angle(yAxis,.6)));
  rotation.reset();
  settle(rotation);
  samePose(rotation.orientation, new Quaternion());
});

test('rotation follows the next good frame without restarting when MediaPipe briefly loses the pose', () => {
  const tracker = createGestureMotion();
  assert.equal(tracker.sample(palm(.50, .50), 0, true).yaw, 0);
  const first = tracker.sample(palm(.55, .46), 34, true);
  assert.ok(first.yaw < 0 && first.pitch < 0);
  assert.equal(tracker.sample({type: 'OTHER_HAND'}, 68, true).yaw, 0);
  const recovered = tracker.sample(palm(.62, .41), 102, true);
  assert.ok(recovered.yaw < 0 && recovered.pitch < 0);
  assert.equal(tracker.sample(null, 300, true).trackedPalm, false);
  assert.equal(tracker.sample(palm(.80, .72), 330, true).yaw, 0);
});

test('relaxed palms can rotate, but rotation stops and rebases on a fist', () => {
  const tracker = createGestureMotion();
  const relaxed = (x, y) => ({...palm(x, y), type: 'OTHER_HAND', loosePalm: true});
  tracker.sample(relaxed(.5, .5), 0, true);
  assert.ok(tracker.sample(relaxed(.55, .55), 35, true).pitch > 0);
  assert.equal(tracker.sample({type:'FIST'}, 60, true).trackedPalm, false);
  assert.equal(tracker.sample(relaxed(.8, .8), 90, true).yaw, 0);
});

test('a slower tracker still rotates on consecutive valid frames', () => {
  const tracker = createGestureMotion();
  tracker.sample(palm(.5, .5), 0, true);
  const movement = tracker.sample(palm(.55, .55), 180, true);
  assert.ok(movement.yaw < 0 && movement.pitch > 0);
});
