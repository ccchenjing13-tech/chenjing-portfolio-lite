import {CAMERA_STATE, createHandInput} from './hand-input.js';
import {APPROACH_STATE, createGestureApproach} from './gesture-approach.js';
import {FLIGHT_CONFIG, FLIGHT_STATE, sampleFlythrough} from './flythrough.js';

const explorePrompt = '移动手掌旋转 · 握拳，张掌向前推';

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
  let galaxy, handInput, cameraStatus, flightStart, fade, fadeTimer;
  let disposed = false;
  let flightState;

  const debug = new URLSearchParams(location.search).get('gestureDebug') === '1';
  let debugLabel;
  if (debug) {
    debugLabel = document.createElement('div');
    debugLabel.className = 'portal__gesture-debug';
    debugLabel.textContent = '正在启动开屏';
    root.append(debugLabel);
  }

  function renderInstructions() {
    if (!cameraStatus || flightState) return;
    const {state, hasTracked, canRetry, awaitingActivation} = cameraStatus;
    root.dataset.cameraState = state;
    retry.hidden = !canRetry;
    const prompts = {
      [CAMERA_STATE.INITIALIZING]: '正在加载手势识别…',
      [CAMERA_STATE.WAITING_FOR_FRAMES]: '正在接收摄像头画面…',
      [CAMERA_STATE.PAUSED]: '切回此页面即可继续手势探索',
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
      [APPROACH_STATE.FIST_SEEN]: '握拳，再张掌向前推',
      [APPROACH_STATE.ARMED]: '张开手掌，顺势向前推',
      [APPROACH_STATE.PALM_OPEN]: '向前推，穿越银河'
    };
    const cameraActive = state === CAMERA_STATE.TRACKING || state === CAMERA_STATE.HAND_LOST;
    const text = (cameraActive && approachPrompts[approach.state]) || cameraHelp(cameraStatus) || prompts[state];
    if (instructions.textContent !== text) instructions.textContent = text;
  }

  function syncApproach() {
    if (!galaxy || flightState) return;
    if (root.dataset.approachState === approach.state) return;
    root.dataset.approachState = approach.state;
    renderInstructions();
    root.dispatchEvent(new CustomEvent('portal-approachchange', {bubbles: true, detail: {
      state: approach.state
    }}));
  }

  function cancelApproach() {
    approach.reset();
    syncApproach();
  }

  function cameraHelp({reason, errorName}) {
    if (reason === 'permission-pending') return '仍在等摄像头授权；若没有弹窗，可用系统浏览器打开';
    if (reason === 'policy' || reason === 'unsupported') return '当前预览无法调用摄像头，可用系统浏览器打开';
    if (reason === 'insecure') return '此网址不支持摄像头，可改用本地预览地址';
    if (reason === 'no-frames') return '已授权，但摄像头未送来画面';
    if (reason === 'tracker-timeout') return '手势识别加载超时 · 可拖动探索银河';
    if (reason === 'ended') return '摄像头已断开 · 可拖动探索银河';
    if (errorName === 'NotFoundError') return '没有找到摄像头 · 可拖动探索银河';
    if (errorName === 'NotReadableError') return '无法打开摄像头，检查它是否被其他应用占用';
  }

  function showCameraStatus(status) {
    cameraStatus = status;
    if (debugLabel) {
      const labels = {
        [CAMERA_STATE.PERMISSION_REQUIRED]: status.awaitingActivation ? '已授权，浏览器要求点按启用' : '等待浏览器授权',
        [CAMERA_STATE.INITIALIZING]: '已授权，正在加载识别器',
        [CAMERA_STATE.WAITING_FOR_FRAMES]: '正在等待摄像头送来第一帧',
        [CAMERA_STATE.TRACKING]: '摄像头正在识别手掌',
        [CAMERA_STATE.HAND_LOST]: '摄像头已接通，暂未检测到手掌',
        [CAMERA_STATE.PERMISSION_DENIED]: '摄像头授权被拒绝或受限',
        [CAMERA_STATE.CAMERA_UNAVAILABLE]: '摄像头不可用',
        [CAMERA_STATE.PAUSED]: '预览在后台，摄像头已暂停',
        [CAMERA_STATE.ERROR]: '手势识别启动失败'
      };
      const detail = status.errorName ? ` · ${status.errorName}` : '';
      debugLabel.textContent = (cameraHelp(status) || labels[status.state]) + detail;
    }
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
    debugLabel?.remove();
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
      if (approach.state === APPROACH_STATE.COMMITTED) startEnterTransition();
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
    if (debugLabel) debugLabel.textContent = '三维场景未启动；摄像头未请求';
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
    cancelApproach();
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
        canControl: () => approach.state !== APPROACH_STATE.COMMITTED && galaxy?.canAcceptGesture(),
        onRotate: (yaw, pitch) => galaxy?.rotateFromGesture(yaw, pitch),
        onState: showCameraStatus,
        onDiagnostics: debugLabel && (({mode, fps, latency, pose}) => {
          const next = `${mode} · ${fps} FPS · ${latency} ms · ${pose} · ${approach.state}`;
          if (debugLabel.textContent !== next) debugLabel.textContent = next;
        }),
        onGesture: detail => root.dispatchEvent(new CustomEvent('portal-gesturechange', {detail, bubbles: true})),
        onHandSample: (palm, time) => {
          if (!galaxy || flightState) return;
          const usable = galaxy.canAcceptGesture() ? palm : null;
          approach.sample(usable, time);
          syncApproach();
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
