export const GESTURE_CONFIG = Object.freeze({
  mirrored: true, // Selfie coordinates: moving right reduces raw camera X.
  radiansPerFrameWidth: 7.5,
  verticalSensitivity: 4.5, // Radians per full camera-frame height, before limits.
  minPitch: -45 * Math.PI / 180,
  maxPitch: 45 * Math.PI / 180,
  maxAbsolutePitch: 86 * Math.PI / 180,
  smoothingSeconds: 0.035,
  rotationResponse: 28,
  deadZone: 0.005,
  maxRadiansPerSecond: 4.3,
  maxRawJump: 0.23,
  maxFrameGapMs: 300,
  openStableMs: 45,
  handLostMs: 160,
  framesPerSecond: 30,
  minFramesPerSecond: 8
});

const PALM_POINTS = [0, 5, 9, 13, 17];
const FINGERS = [[5, 6, 8], [9, 10, 12], [13, 14, 16], [17, 18, 20]];
const distance = (a, b, aspect) => Math.hypot((a.x - b.x) * aspect, a.y - b.y, (a.z - b.z) * aspect);

function fingerExtended(landmarks, [base, joint, tip], aspect) {
  const a = landmarks[base], b = landmarks[joint], c = landmarks[tip];
  const firstLength = distance(a, b, aspect), secondLength = distance(b, c, aspect);
  if (firstLength * secondLength < 1e-6) return false;
  const dot = (b.x - a.x) * (c.x - b.x) * aspect ** 2
    + (b.y - a.y) * (c.y - b.y) + (b.z - a.z) * (c.z - b.z) * aspect ** 2;
  return dot / (firstLength * secondLength) > 0.43
    && distance(c, landmarks[0], aspect) > 1.07 * distance(b, landmarks[0], aspect);
}

function fingerCurled(landmarks, [base, joint, tip], aspect) {
  const proximal = distance(landmarks[base], landmarks[joint], aspect);
  const reach = distance(landmarks[base], landmarks[tip], aspect);
  const fold = distance(landmarks[joint], landmarks[tip], aspect);
  // A bent finger can still point away from the wrist when the fist is seen side-on.
  return proximal > .003 && reach < 1.6 * proximal && fold > .35 * proximal
    && reach < .8 * (proximal + fold);
}

export function describePalm(landmarks, aspect = 1) {
  if (landmarks?.length !== 21 || !landmarks.every(point =>
    Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z))) return null;
  const x = PALM_POINTS.reduce((sum, index) => sum + landmarks[index].x, 0) / PALM_POINTS.length;
  const y = PALM_POINTS.reduce((sum, index) => sum + landmarks[index].y, 0) / PALM_POINTS.length;
  const scale = (distance(landmarks[0], landmarks[9], aspect)
    + distance(landmarks[5], landmarks[17], aspect)) / 2;
  const extended = FINGERS.filter(finger => fingerExtended(landmarks, finger, aspect));
  const open = extended.length >= 3 && scale > 0.025;
  const firmPoint = extended.some(([base, joint, tip]) =>
    distance(landmarks[tip], landmarks[base], aspect) > 1.7 * distance(landmarks[joint], landmarks[base], aspect));
  const curled = FINGERS.filter(finger => fingerCurled(landmarks, finger, aspect)).length;
  const fist = scale > .025 && !firmPoint && (curled >= 3 && extended.length <= 1
    || curled >= 2 && extended.length === 0);
  const fistConfidence = fist ? (curled >= 3 ? 'clear' : 'soft') : undefined;
  const palmDistance = (a, b) => Math.hypot((landmarks[a].x - landmarks[b].x) * aspect, landmarks[a].y - landmarks[b].y);
  const palmWidth = palmDistance(5, 17), palmHeight = palmDistance(0, 9);
  const approachScale = Math.sqrt(palmWidth * palmHeight);
  const type = open ? 'OPEN_PALM' : fist ? 'FIST' : 'OTHER_HAND';
  return {x, y, scale, approachScale, palmWidth, palmHeight, type, fistConfidence};
}

function createAxisFilter(config, sensitivity) {
  let previous;
  let filtered;
  let anchor;
  let sampledAt;

  return {
    clear() {
      previous = filtered = anchor = sampledAt = undefined;
    },
    sample(value, timestamp, stable) {
      const dtMs = timestamp - sampledAt;
      if (sampledAt === undefined || dtMs <= 0 || dtMs > config.maxFrameGapMs
        || Math.abs(value - previous) > config.maxRawJump) {
        previous = filtered = anchor = value;
        sampledAt = timestamp;
        return 0;
      }

      const seconds = dtMs / 1000;
      previous = value;
      sampledAt = timestamp;
      filtered += (value - filtered) * (1 - Math.exp(-seconds / config.smoothingSeconds));
      if (!stable) {
        anchor = filtered;
        return 0;
      }
      const offset = filtered - anchor;
      const movement = Math.sign(offset) * Math.max(0, Math.abs(offset) - config.deadZone);
      const stepLimit = config.maxRadiansPerSecond * seconds;
      // Keep only the small dead band. A speed-limited sample never queues catch-up rotation.
      anchor += movement;
      return Math.max(-stepLimit, Math.min(stepLimit, movement * sensitivity));
    }
  };
}

export function createGestureMotion(config = GESTURE_CONFIG) {
  let type = 'NO_HAND';
  let since = 0;
  const horizontal = createAxisFilter(config, config.radiansPerFrameWidth);
  const vertical = createAxisFilter(config, config.verticalSensitivity);

  function clearPosition() {
    horizontal.clear();
    vertical.clear();
  }

  return {
    reset() {
      type = 'NO_HAND';
      since = 0;
      clearPosition();
    },
    sample(palm, timestamp, canControl) {
      const nextType = palm?.type ?? 'NO_HAND';
      const changed = type !== nextType;
      if (changed) {
        type = nextType;
        since = timestamp;
        clearPosition();
      }
      const gesture = {type, stableMs: timestamp - since, scale: palm?.scale ?? null};
      if (!canControl || type !== 'OPEN_PALM') {
        clearPosition();
        return {yaw: 0, pitch: 0, gesture, changed};
      }

      const stable = gesture.stableMs >= config.openStableMs;
      const x = config.mirrored ? 1 - palm.x : palm.x;
      const yaw = horizontal.sample(x, timestamp, stable);
      // Camera Y and the existing vertical drag both increase down the screen.
      let pitch = 0;
      if (Number.isFinite(palm.y)) pitch = vertical.sample(palm.y, timestamp, stable);
      else vertical.clear();
      return {yaw, pitch, gesture, changed};
    }
  };
}
