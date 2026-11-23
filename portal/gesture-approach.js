export const APPROACH_STATE = Object.freeze({
  EXPLORING: 'EXPLORING',
  FIST_CONFIRMING: 'FIST_CONFIRMING',
  ARMED: 'ARMED',
  PALM_OPEN: 'PALM_OPEN',
  PUSHING: 'PUSHING',
  RETURNING: 'RETURNING'
});

export const APPROACH_CONFIG = Object.freeze({
  fistMs: 500, fistFrames: 4,
  fistDropoutMs: 160,
  openMs: 250, openFrames: 3,
  cancelFistMs: 350,
  frameGapMs: 260,
  lostMs: 1500,
  armedMs: 7000,
  openReacquireMs: 400,
  minPalmScale: .025,
  calibrationSpread: .12,
  deadZone: .035,
  fullRatio: 1.45,
  ratioJump: .22,
  smoothingSeconds: .105,
  maxProgressPerSecond: 1.65,
  cameraResponse: 8.5,
  minCameraDistance: 15.2,
  cameraEndRatio: .56
});

const clamp01 = value => Math.max(0, Math.min(1, value));
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export function approachEndDistance(start, config = APPROACH_CONFIG) {
  return Math.min(start, Math.max(config.minCameraDistance, start * config.cameraEndRatio));
}

export function easeApproach(progress, target, dt, config = APPROACH_CONFIG) {
  const delta = target - progress;
  return Math.abs(delta) < .001 ? target : target - delta * Math.exp(-dt * config.cameraResponse);
}

export function createGestureApproach(config = APPROACH_CONFIG) {
  const mode = APPROACH_STATE;
  let state = mode.EXPLORING;
  let target = 0;
  let lastSeen = -Infinity;
  let lastSample = -Infinity;
  let armedAt = 0;
  let requireOpen = false;
  let evidence = '';
  let since = 0;
  let count = 0;
  let lastFistAt = -Infinity;
  let fistHeldMs = 0;
  let fistInterrupted = false;
  let calibration = [];
  let referenceScale = 0;
  let filteredRatio = 1;
  let previousRatio = 1;
  let pendingRatio;
  let rebase = false;
  let lastOpenAt = -Infinity;
  const ratioRange = config.fullRatio - 1 - config.deadZone;

  function clearEvidence() {
    evidence = '';
    count = 0;
    calibration = [];
  }

  function transition(next) {
    state = next;
    clearEvidence();
    lastFistAt = -Infinity;
    fistHeldMs = 0;
    fistInterrupted = false;
  }

  function observe(type, timestamp, duration, minFrames) {
    if (evidence !== type) {
      evidence = type;
      since = timestamp;
      count = 0;
    }
    count++;
    return count >= minFrames && timestamp - since >= duration;
  }

  function confirmFist(type, timestamp) {
    const sinceLastFist = timestamp - lastFistAt;
    if (type !== 'FIST') {
      if (type === 'OPEN_PALM' || sinceLastFist >= config.fistDropoutMs) transition(mode.EXPLORING);
      else fistInterrupted = true;
      return;
    }
    if (fistInterrupted && sinceLastFist >= config.fistDropoutMs) transition(mode.FIST_CONFIRMING);
    if (!fistInterrupted && count) fistHeldMs += sinceLastFist;
    count++;
    lastFistAt = timestamp;
    fistInterrupted = false;
    if (count >= config.fistFrames && fistHeldMs >= config.fistMs) {
      armedAt = timestamp;
      transition(mode.ARMED);
    }
  }

  function cancel() {
    if (state === mode.EXPLORING || state === mode.RETURNING) return;
    target = 0;
    requireOpen = true;
    transition(mode.RETURNING);
  }

  function hold(progress, resetReference = true) {
    if (state !== mode.PUSHING || rebase) return;
    target = clamp01(progress);
    rebase = resetReference;
    pendingRatio = undefined;
  }

  function updatePush(scale, seconds, progress) {
    if (rebase) {
      target = clamp01(progress);
      const ratio = target ? 1 + config.deadZone + target * ratioRange : 1;
      referenceScale = scale / ratio;
      filteredRatio = previousRatio = ratio;
      pendingRatio = undefined;
      rebase = false;
      return;
    }

    const ratio = scale / referenceScale;
    if (Math.abs(ratio - previousRatio) > config.ratioJump
      && (pendingRatio === undefined || Math.abs(ratio - pendingRatio) > config.deadZone)) {
      pendingRatio = ratio;
      return;
    }
    pendingRatio = undefined;
    previousRatio = ratio;
    filteredRatio += (ratio - filteredRatio) * (1 - Math.exp(-seconds / config.smoothingSeconds));
    const wanted = ratio >= config.fullRatio && filteredRatio >= config.fullRatio - .006
      ? 1 : clamp01((filteredRatio - 1 - config.deadZone) / ratioRange);
    const step = config.maxProgressPerSecond * seconds;
    target += Math.max(-step, Math.min(step, wanted - target));
  }

  return {
    get state() { return state; },
    get target() { return target; },
    get rotationLocked() {
      return state !== mode.EXPLORING && state !== mode.FIST_CONFIRMING;
    },
    cancel,
    finishReturn() {
      if (state === mode.RETURNING) transition(mode.EXPLORING);
    },
    sample(palm, timestamp, progress) {
      const gap = timestamp - lastSample;
      if (timestamp <= lastSample) return;
      lastSample = timestamp;
      if (state === mode.RETURNING) return;
      if (state !== mode.EXPLORING && timestamp - lastSeen >= config.lostMs) {
        cancel();
        return;
      }
      if ((state === mode.ARMED || state === mode.PALM_OPEN) && timestamp - armedAt >= config.armedMs) {
        cancel();
        return;
      }
      if (gap > config.frameGapMs && state === mode.FIST_CONFIRMING) transition(mode.EXPLORING);
      if (palm) lastSeen = timestamp;
      const scale = palm?.approachScale;
      const open = palm?.type === 'OPEN_PALM' && Number.isFinite(scale) && scale >= config.minPalmScale;
      const fist = palm?.type === 'FIST';

      if (state === mode.EXPLORING) {
        if (open) requireOpen = false;
        if (!fist || requireOpen) return;
        transition(mode.FIST_CONFIRMING);
      }
      if (state === mode.FIST_CONFIRMING) {
        confirmFist(palm?.type, timestamp);
        return;
      }

      if (!palm || gap > config.frameGapMs) {
        clearEvidence();
        hold(progress);
        if (!palm) return;
      }
      if (state === mode.ARMED || state === mode.PALM_OPEN) {
        if (!open) {
          if (state === mode.PALM_OPEN) transition(mode.ARMED);
          return;
        }
        if (state === mode.ARMED) transition(mode.PALM_OPEN);
        if (calibration.length && Math.abs(scale / calibration[0] - 1) > config.calibrationSpread) clearEvidence();
        calibration.push(scale);
        if (observe('open', timestamp, config.openMs, config.openFrames)) {
          referenceScale = median(calibration);
          previousRatio = filteredRatio = 1;
          pendingRatio = undefined;
          rebase = false;
          lastOpenAt = timestamp;
          transition(mode.PUSHING);
        }
      } else if (state === mode.PUSHING) {
        if (!open) {
          // Keep the distance reference through a brief pose misclassification.
          hold(progress, timestamp - lastOpenAt >= config.openReacquireMs);
          if (fist && observe('cancel', timestamp, config.cancelFistMs, config.fistFrames)) cancel();
          if (!fist) clearEvidence();
          return;
        }
        clearEvidence();
        lastOpenAt = timestamp;
        updatePush(scale, Math.min(gap, config.frameGapMs) / 1000, progress);
      }
    }
  };
}
