export const FLIGHT_STATE = Object.freeze({
  ENTERING: 'ENTERING',
  TRANSITIONING: 'TRANSITIONING',
  COMPLETED: 'COMPLETED'
});

export const FLIGHT_CONFIG = Object.freeze({
  approachMs: 600,
  cloudMs: 1580,
  travelMs: 2050,
  revealMs: 1820,
  durationMs: 2250,
  reducedMotionMs: 240,
  pastCoreDistance: 1.8,
  launchMomentum: .30
});

const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};
const between = (time, start, end) => smooth((time - start) / (end - start));

export function sampleFlythrough(milliseconds, config = FLIGHT_CONFIG) {
  const t = clamp(milliseconds / config.travelMs);
  return {
    travel: config.launchMomentum * t + (1 - config.launchMomentum) * t ** 2.05,
    controls: 1 - between(milliseconds, 40, config.approachMs),
    glow: .98 * between(milliseconds, config.cloudMs - 220, config.travelMs - 110),
    radius: 14 + 68 * between(milliseconds, config.cloudMs - 170, config.travelMs),
    overlay: 1 - between(milliseconds, config.revealMs, config.durationMs),
    state: milliseconds < config.cloudMs ? FLIGHT_STATE.ENTERING : FLIGHT_STATE.TRANSITIONING,
    done: milliseconds >= config.durationMs
  };
}
