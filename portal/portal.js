import {CAMERA_STATE, createHandInput} from './hand-input.js';
import {APPROACH_STATE, createGestureApproach} from './gesture-approach.js';
import {createEntranceHold, FLIGHT_CONFIG, FLIGHT_STATE, sampleFlythrough} from './flythrough.js';

const explorePrompt = '移动手掌旋转 · 握拳后可推进';

export function mountPortal(root, finish) {
  const container = root.querySelector('#galaxy');
  const message = root.querySelector('#portal-message');
  const instructions = root.querySelector('#galaxy-instructions');
  const retry = root.querySelector('#portal-retry');
  const enter = root.querySelector('#portal-enter');
  const skip = root.querySelector('#portal-skip');
  const lifetime = new AbortController();
  const {signal} = lifetime;
  const approach = createGestureApproach();
  const entranceHold = createEntranceHold();
  let galaxy, handInput, cameraStatus, flightStart, fade, fadeTimer;
  let disposed = false;
  let flightState;
  let entranceReady = false;

  function renderInstructions() {
    if (!cameraStatus || flightState) return;
    const {state, hasTracked, canRetry, awaitingActivation} = cameraStatus;
    root.dataset.cameraState = state;
    retry.hidden = !canRetry;
    const prompts = {
      [CAMERA_STATE.INITIALIZING]: '正在连接你的宇宙……',
      [CAMERA_STATE.PERMISSION_REQUIRED]: awaitingActivation
        ? '也可以用鼠标或触摸探索银河'
        : '允许使用摄像头，便可以用手掌探索银河',
      [CAMERA_STATE.TRACKING]: explorePrompt,
      [CAMERA_STATE.HAND_LOST]: hasTracked ? '等待你的手掌重新出现' : explorePrompt,
      [CAMERA_STATE.PERMISSION_DENIED]: '也可以用鼠标或触摸探索银河',
      [CAMERA_STATE.CAMERA_UNAVAILABLE]: '摄像头不可用 · 可拖动探索银河',
      [CAMERA_STATE.ERROR]: '手势识别暂不可用 · 可拖动探索银河'
    };
    const approachPrompts = {
      [APPROACH_STATE.FIST_CONFIRMING]: '保持握拳，等待确认',
      [APPROACH_STATE.ARMED]: '握拳已确认 · 原地张开手掌',
      [APPROACH_STATE.PALM_OPEN]: '保持张掌不动，正在校准距离',
      [APPROACH_STATE.PUSHING]: galaxy?.approachProgress >= FLIGHT_CONFIG.entranceProgress
        ? '保持手掌，准备穿越' : '已就绪 · 手掌向摄像头缓慢推进',
      [APPROACH_STATE.RETURNING]: '正在返回自由探索'
    };
    const cameraActive = state === CAMERA_STATE.TRACKING || state === CAMERA_STATE.HAND_LOST;
    const text = (cameraActive && approachPrompts[approach.state]) || prompts[state];
    if (instructions.textContent !== text) instructions.textContent = text;
  }

  function syncApproach() {
    if (!galaxy || flightState) return;
    if (galaxy.approachProgress === 0) approach.finishReturn();
    galaxy.setApproachTarget(approach.target);
    galaxy.lockGestureRotation(approach.rotationLocked);
    const atEntrance = approach.state === APPROACH_STATE.PUSHING
      && galaxy.approachProgress >= FLIGHT_CONFIG.entranceProgress;
    if (root.dataset.approachState === approach.state && root.dataset.atEntrance === String(atEntrance)) return;
    root.dataset.approachState = approach.state;
    root.dataset.atEntrance = String(atEntrance);
    renderInstructions();
    root.dispatchEvent(new CustomEvent('portal-approachchange', {bubbles: true, detail: {
      state: approach.state,
      progress: galaxy.approachProgress,
      targetProgress: approach.target,
      cameraDistance: galaxy.approachCameraDistance,
      endDistance: galaxy.approachEndDistance,
      atEntrance
    }}));
  }

  function cancelApproach() {
    entranceReady = false;
    entranceHold(performance.now(), false, 0, 0);
    approach.cancel();
    syncApproach();
  }

  function showCameraStatus(status) {
    cameraStatus = status;
    if (status.state === CAMERA_STATE.ERROR || status.state === CAMERA_STATE.CAMERA_UNAVAILABLE) cancelApproach();
    renderInstructions();
  }

  function stopHandInput() {
    handInput?.stop();
    handInput = undefined;
  }

  function setFlightState(state) {
    if (flightState === state) return;
    flightState = state;
    root.dataset.flightState = state;
  }

  function complete(options) {
    setFlightState(FLIGHT_STATE.COMPLETED);
    finish(options);
  }

  function startEnterTransition() {
    if (disposed || flightState) return;
    setFlightState(FLIGHT_STATE.ENTERING);
    enter.disabled = true;
    retry.hidden = true;
    if (document.activeElement === enter || document.activeElement === container) skip.focus({preventScroll: true});
    instructions.textContent = '正在穿越银河…';
    stopHandInput();

    try {
      const core = galaxy?.beginFlythrough(FLIGHT_CONFIG.pastCoreDistance);
      if (!core || window.matchMedia('(prefers-reduced-motion:reduce)').matches) {
        setFlightState(FLIGHT_STATE.TRANSITIONING);
        fade = root.animate([{opacity: 1}, {opacity: 0}], {
          duration: FLIGHT_CONFIG.reducedMotionMs, easing: 'ease-out', fill: 'forwards'
        });
        fadeTimer = setTimeout(() => complete(), FLIGHT_CONFIG.reducedMotionMs);
        return;
      }

      root.style.setProperty('--portal-core-x', `${core.x}%`);
      root.style.setProperty('--portal-core-y', `${core.y}%`);
      flightStart = performance.now();
      // The timeout also hands off if animation frames stop unexpectedly.
      fadeTimer = setTimeout(() => complete(), FLIGHT_CONFIG.durationMs + 350);
    } catch (error) {
      console.error('Planet Portal transition interrupted:', error);
      complete();
    }
  }

  function onGalaxyFrame(time) {
    if (!flightState) {
      syncApproach();
      if (entranceReady) startEnterTransition();
    }
    if (flightStart === undefined) return;
    const sample = sampleFlythrough(time - flightStart);
    galaxy.flyThroughTo(sample.travel);
    setFlightState(sample.state);
    root.style.setProperty('--portal-flight-controls', sample.controls);
    root.style.setProperty('--portal-flight-glow', sample.glow);
    root.style.setProperty('--portal-flight-radius', `${sample.radius}%`);
    root.style.opacity = sample.overlay;
    if (sample.done) complete();
  }

  function handleSceneError(text) {
    if (disposed) return;
    if (flightState) {
      complete();
      return;
    }
    stopHandInput();
    galaxy?.dispose();
    galaxy = undefined;
    enter.disabled = false;
    root.classList.remove('is-ready');
    message.textContent = text;
    message.hidden = false;
    instructions.hidden = retry.hidden = true;
    container.removeAttribute('tabindex');
    container.setAttribute('aria-label', '银河静态背景');
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    lifetime.abort();
    clearTimeout(fadeTimer);
    fade?.cancel();
    stopHandInput();
    galaxy?.dispose();
    galaxy = undefined;
  }

  container.addEventListener('galaxy-error', event => handleSceneError(event.detail), {signal});
  enter.addEventListener('click', startEnterTransition, {signal});
  retry.addEventListener('click', () => handInput?.retry(), {signal});
  skip.addEventListener('click', event => {
    event.preventDefault();
    complete();
  }, {signal});
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    entranceReady = false;
    entranceHold(performance.now(), false, 0, 0);
    if (flightState) complete({focus: false});
  }, {signal});

  async function initialize() {
    try {
      const {createGalaxy} = await import('./galaxy-scene.js');
      if (disposed || flightState) return;
      galaxy = createGalaxy(container, {onManualInput: cancelApproach, onFrame: onGalaxyFrame});
      enter.disabled = false;
      root.classList.add('is-ready');
      syncApproach();
      handInput = createHandInput({
        canControl: () => !approach.rotationLocked && galaxy?.canAcceptGesture(),
        onRotate: (yaw, pitch) => galaxy?.rotateFromGesture(yaw, pitch),
        onState: showCameraStatus,
        onGesture: detail => root.dispatchEvent(new CustomEvent('portal-gesturechange', {detail, bubbles: true})),
        onHandSample: (palm, time) => {
          if (!galaxy || flightState) return;
          const usable = galaxy.canAcceptGesture() ? palm : null;
          approach.sample(usable, time, galaxy.approachProgress);
          syncApproach();
          // Finish the dwell only on a new open-palm sample, never on stale RAF frames.
          const eligible = approach.state === APPROACH_STATE.PUSHING && usable?.type === 'OPEN_PALM';
          entranceReady = entranceHold(performance.now(), eligible, galaxy.approachProgress, approach.target);
        }
      });
      handInput.start();
    } catch (error) {
      console.warn('Planet Portal 3D is unavailable:', error);
      handleSceneError('当前设备未能开启三维显示，仍可直接进入网站。');
    }
  }

  void initialize();
  return {
    dispose,
    unload() { complete({record: Boolean(flightState), focus: false}); }
  };
}
