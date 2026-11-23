export const APPROACH_STATE = Object.freeze({
  EXPLORING: 'EXPLORING',
  FIST_SEEN: 'FIST_SEEN',
  ARMED: 'ARMED',
  PALM_OPEN: 'PALM_OPEN',
  COMMITTED: 'COMMITTED'
});

export const APPROACH_CONFIG = Object.freeze({
  softFistMs: 45,
  openAfterFistMs: 1250,
  maxSampleGapMs: 400,
  maxTrackingLossMs: 200,
  pushWindowMs: 1100,
  minPalmScale: .025,
  pushRatio: 1.12,
  minAxisRatio: 1.04,
  quickPushRatio: 1.19,
  quickAxisRatio: 1.11,
  quickFollowThrough: 1.025,
  spikeRatio: 1.27
});

export function createGestureApproach(config = APPROACH_CONFIG) {
  const mode = APPROACH_STATE;
  let state = mode.EXPLORING;
  let lastTime = -Infinity;
  let lastTrackedAt = -Infinity;
  let trackingInterrupted = false;
  let firstFistAt = -Infinity;
  let lastFistAt = -Infinity;
  let openedAt = -Infinity;
  let fistBase, palmBase, spike;

  function reset() {
    if (state === mode.COMMITTED) return;
    state = mode.EXPLORING;
    firstFistAt = lastFistAt = openedAt = -Infinity;
    trackingInterrupted = false;
    fistBase = palmBase = spike = undefined;
  }

  function grew(sample, base, ratio, axisRatio) {
    return base && sample && sample.scale >= base.scale * ratio
      && sample.width >= base.width * axisRatio && sample.height >= base.height * axisRatio;
  }

  function size(palm) {
    const scale = palm?.approachScale;
    const width = palm?.palmWidth ?? scale;
    const height = palm?.palmHeight ?? scale;
    return Number.isFinite(scale) && scale >= config.minPalmScale && width > 0 && height > 0
      ? {scale, width, height} : undefined;
  }

  return {
    get state() { return state; },
    reset,
    sample(palm, timestamp) {
      if (state === mode.COMMITTED || timestamp <= lastTime) return false;
      if (timestamp - lastTime > config.maxSampleGapMs) reset();
      lastTime = timestamp;

      const sample = size(palm);
      const open = palm?.type === 'OPEN_PALM' && sample;
      const fist = palm?.type === 'FIST' && sample;
      if (trackingInterrupted && timestamp - lastTrackedAt >= config.maxTrackingLossMs) reset();
      trackingInterrupted = !open && !fist;
      if (!trackingInterrupted) lastTrackedAt = timestamp;

      if (fist) {
        if (state !== mode.FIST_SEEN && state !== mode.ARMED) {
          reset();
          firstFistAt = timestamp;
        }
        lastFistAt = timestamp;
        fistBase = sample;
        // A clear fist can be brief: opening and the push still have to follow.
        if (state !== mode.ARMED) state = palm.fistConfidence !== 'soft'
          || timestamp - firstFistAt >= config.softFistMs ? mode.ARMED : mode.FIST_SEEN;
        return false;
      }

      if (state === mode.FIST_SEEN || state === mode.ARMED) {
        if (timestamp - lastFistAt > config.openAfterFistMs) reset();
        else if (open && state === mode.ARMED) {
          state = mode.PALM_OPEN;
          openedAt = timestamp;
          palmBase = sample; // Capture the first open frame while the hand is already moving.
        } else if (open) reset();
        return false;
      }

      if (state !== mode.PALM_OPEN) return false;
      if (timestamp - openedAt > config.pushWindowMs) {
        reset();
        return false;
      }
      if (!open) return false;

      const ratio = sample.scale / palmBase.scale;
      const quickPush = ratio >= config.quickFollowThrough
        && grew(sample, fistBase, config.quickPushRatio, config.quickAxisRatio);
      if (!quickPush && !grew(sample, palmBase, config.pushRatio, config.minAxisRatio)) {
        spike = undefined;
        return false;
      }
      // A big isolated change in hand size can be a tracking error.
      if (ratio > config.spikeRatio && (!spike || sample.scale < spike.scale * .93)) {
        spike = sample;
        return false;
      }
      state = mode.COMMITTED;
      return true;
    }
  };
}
