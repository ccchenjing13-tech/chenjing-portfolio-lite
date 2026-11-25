import {Quaternion, Vector3} from './vendor/three-r180/three.module.min.js';

const FULL_TURN = 2 * Math.PI;
const SETTLE_THRESHOLD = 0.00001;

export function dragToRotation(deltaX, deltaY, width, height) {
  return {
    yaw: deltaX * FULL_TURN / width,
    pitch: deltaY * FULL_TURN / height
  };
}

export function createGalaxyRotation(initialOrientation) {
  const home = initialOrientation.clone();
  const orientation = home.clone();
  const base = home.clone();
  const axis = new Vector3();
  const horizontalAxis = new Vector3(1, 0, 0);
  const step = new Quaternion();
  const pitchRotation = new Quaternion();
  let pendingYaw = 0;
  let pendingPitch = 0;
  let gesturePitch = 0;
  let targetGesturePitch = 0;
  let returning = false;
  let manual = false;

  return {
    orientation,

    turn(yaw, pitch) {
      returning = false;
      manual = true;
      pendingYaw += yaw;
      pendingPitch += pitch;
    },

    turnGesture(yaw, pitch, minPitch, maxPitch) {
      returning = false;
      manual = false;
      pendingYaw += yaw;
      // Clamp the target, so motion at an edge cannot build up or bounce back.
      targetGesturePitch = Math.max(minPitch, Math.min(maxPitch, targetGesturePitch + pitch));
    },

    hold() {
      pendingYaw = pendingPitch = 0;
      targetGesturePitch = gesturePitch;
      returning = false;
    },

    reset() {
      pendingYaw = 0;
      pendingPitch = 0;
      base.copy(orientation);
      gesturePitch = targetGesturePitch = 0;
      returning = true;
    },

    update(deltaSeconds, immediate = false, response = 14) {
      const blend = immediate ? 1 : 1 - Math.exp(-response * deltaSeconds);
      if (returning) {
        base.slerp(home, blend);
        if (base.angleTo(home) < SETTLE_THRESHOLD) {
          base.copy(home);
          returning = false;
        }
        orientation.copy(base);
        return;
      }

      const remainingAngle = Math.hypot(pendingPitch, pendingYaw);
      const pitchDelta = targetGesturePitch - gesturePitch;
      if (remainingAngle === 0 && pitchDelta === 0) return;

      if (remainingAngle !== 0) {
        const fraction = remainingAngle < SETTLE_THRESHOLD ? 1 : blend;
        axis.set(pendingPitch / remainingAngle, pendingYaw / remainingAngle, 0);
        step.setFromAxisAngle(axis, remainingAngle * fraction);
        if (manual && gesturePitch !== 0) {
          // Apply manual input to the displayed pose, then remove its existing pitch
          // layer to recover the base pose without making mouse or touch feel different.
          pitchRotation.setFromAxisAngle(horizontalAxis, -gesturePitch);
          base.copy(orientation).premultiply(step).premultiply(pitchRotation).normalize();
        } else {
          base.premultiply(step).normalize();
        }
        pendingYaw *= 1 - fraction;
        pendingPitch *= 1 - fraction;
      }

      gesturePitch = Math.abs(pitchDelta) < SETTLE_THRESHOLD
        ? targetGesturePitch : gesturePitch + pitchDelta * blend;
      orientation.copy(base);
      if (gesturePitch !== 0) {
        pitchRotation.setFromAxisAngle(horizontalAxis, gesturePitch);
        orientation.premultiply(pitchRotation).normalize();
      }
    }
  };
}
