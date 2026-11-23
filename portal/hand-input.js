import {createGestureMotion, GESTURE_CONFIG} from './gesture-motion.js';
import {openHandTracker} from './hand-landmarker.js';

export const CAMERA_STATE = Object.freeze({
  INITIALIZING: 'INITIALIZING',
  PERMISSION_REQUIRED: 'PERMISSION_REQUIRED',
  TRACKING: 'TRACKING',
  HAND_LOST: 'HAND_LOST',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  CAMERA_UNAVAILABLE: 'CAMERA_UNAVAILABLE',
  ERROR: 'ERROR'
});

const emptyGesture = () => ({type: 'NO_HAND', stableMs: 0, scale: null});

export function createHandInput({
  canControl, onRotate, onState, onGesture, onHandSample = () => {},
  loadTracker = openHandTracker,
  config = GESTURE_CONFIG
}) {
  const motion = createGestureMotion(config);
  const lifetime = new AbortController();
  let tracker, trackerLifetime, stream, video, startTask;
  let stopped = false;
  let started = false;
  let retried = false;
  let retryAllowed = false;
  let hasTracked = false;
  let currentGesture = emptyGesture();
  let currentState;
  let timeout;
  let playback = 0;
  let inferencePending = false;
  let minimumInterval = 1000 / config.framesPerSecond;
  let lastVideoTime = -1;
  let lastOpen = -Infinity;
  let lastHandSample = -Infinity;
  let averageInferenceMs = 0;

  function status(state, detail = {}) {
    const next = {state, hasTracked, canRetry: retryAllowed, awaitingActivation: false, ...detail};
    if (currentState && Object.keys(next).every(key => next[key] === currentState[key])) return;
    currentState = next;
    onState(next);
  }

  function resetGesture() {
    motion.reset();
    const previous = currentGesture;
    currentGesture = emptyGesture();
    if (previous.type !== 'NO_HAND') onGesture({...currentGesture});
    lastOpen = -Infinity;
  }

  function pause() {
    playback++;
    clearTimeout(timeout);
    resetGesture();
    video?.pause();
    stream?.getTracks().forEach(track => { track.enabled = false; });
  }

  function release() {
    pause();
    const tracks = stream?.getTracks();
    stream = undefined;
    tracks?.forEach(track => track.stop());
    if (video) {
      video.srcObject = null;
      video.remove();
      video = undefined;
    }
    trackerLifetime?.abort();
    trackerLifetime = undefined;
    tracker?.close();
    tracker = undefined;
  }

  function fail(state) {
    release();
    status(state);
  }

  function schedule(delay = 0) {
    timeout = setTimeout(readFrame, delay);
  }

  async function readFrame() {
    if (stopped || document.hidden || !tracker || !video) return;
    if (inferencePending) {
      schedule(minimumInterval);
      return;
    }
    const attempt = playback;
    const now = performance.now();
    try {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        inferencePending = true;
        const palm = await tracker.sample(video, now);
        if (attempt !== playback || stopped || document.hidden) return;
        lastHandSample = now;
        onHandSample(palm, now);
        const {yaw, pitch, gesture, changed} = motion.sample(palm, now, canControl());
        currentGesture = gesture;
        if (changed) onGesture({...gesture});

        if (gesture.type === 'OPEN_PALM') {
          lastOpen = now;
          if (gesture.stableMs >= config.openStableMs) {
            hasTracked = true;
            status(CAMERA_STATE.TRACKING);
            if (yaw || pitch) onRotate(yaw, pitch);
          }
        }
        const cost = performance.now() - now;
        averageInferenceMs += (cost - averageInferenceMs) * 0.2;
        const targetInterval = Math.min(1000 / config.minFramesPerSecond,
          Math.max(minimumInterval, averageInferenceMs * 1.15));
        if (now - lastOpen >= config.handLostMs) status(CAMERA_STATE.HAND_LOST);
        // The cadence is measured between starts; inference is already part of that time.
        schedule(Math.max(0, targetInterval - cost));
      } else {
        if (now - lastHandSample >= config.handLostMs) {
          lastHandSample = now;
          onHandSample(null, now);
        }
        if (now - lastOpen >= config.handLostMs) {
          if (currentGesture.type !== 'NO_HAND') resetGesture();
          status(CAMERA_STATE.HAND_LOST);
        }
        schedule(8);
      }
    } catch {
      if (attempt === playback && !stopped) fail(CAMERA_STATE.ERROR);
    } finally {
      inferencePending = false;
    }
  }

  async function resume() {
    if (stopped || document.hidden || !video || !tracker) return;
    const attempt = ++playback;
    stream.getVideoTracks().forEach(track => { track.enabled = true; });
    try {
      await video.play();
      if (attempt !== playback || stopped || document.hidden) return;
      lastVideoTime = -1;
      status(CAMERA_STATE.HAND_LOST);
      schedule();
    } catch (error) {
      if (attempt !== playback || stopped || document.hidden) return;
      if (error.name === 'NotAllowedError' && !retried) {
        retryAllowed = true;
        // Retain the already-authorized stream for a user-initiated play() retry.
        pause();
        status(CAMERA_STATE.PERMISSION_REQUIRED, {awaitingActivation: true});
      } else {
        fail(CAMERA_STATE.ERROR);
      }
    }
  }

  async function requestCamera() {
    const policy = document.permissionsPolicy ?? document.featurePolicy;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia
      || policy?.allowsFeature?.('camera') === false) {
      status(CAMERA_STATE.CAMERA_UNAVAILABLE);
      return;
    }

    status(CAMERA_STATE.PERMISSION_REQUIRED);
    let acquired;
    try {
      acquired = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {facingMode: {ideal: 'user'}, width: {ideal: 640}, height: {ideal: 480}, frameRate: {ideal: 30, max: 30}}
      });
    } catch (error) {
      if (stopped) return;
      if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
        let permission;
        try { permission = (await navigator.permissions?.query({name: 'camera'}))?.state; } catch { /* optional API */ }
        if (stopped) return;
        retryAllowed = !retried && permission !== 'denied' && error.name === 'NotAllowedError';
        status(CAMERA_STATE.PERMISSION_DENIED);
      } else if (['NotFoundError', 'NotReadableError', 'OverconstrainedError', 'AbortError'].includes(error.name)) {
        status(CAMERA_STATE.CAMERA_UNAVAILABLE);
      } else {
        status(CAMERA_STATE.ERROR);
      }
      return;
    }
    if (stopped) {
      acquired.getTracks().forEach(track => track.stop());
      return;
    }

    stream = acquired;
    const track = stream.getVideoTracks()[0];
    if (!track || track.readyState === 'ended') {
      fail(CAMERA_STATE.CAMERA_UNAVAILABLE);
      return;
    }
    track.enabled = false;
    track.addEventListener('ended', () => fail(CAMERA_STATE.CAMERA_UNAVAILABLE), {signal: lifetime.signal, once: true});
    video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.hidden = true;
    video.setAttribute('aria-hidden', 'true');
    document.body.append(video);
    video.srcObject = stream;
    status(CAMERA_STATE.INITIALIZING);
    trackerLifetime = new AbortController();
    try {
      const loaded = await loadTracker(trackerLifetime.signal);
      if (stopped || stream !== acquired) {
        loaded.close();
        return;
      }
      tracker = loaded;
      minimumInterval = 1000 / (tracker.mode === 'main' ? Math.min(12, config.framesPerSecond) : config.framesPerSecond);
      averageInferenceMs = 0;
      void resume();
    } catch {
      if (!stopped && stream === acquired) fail(CAMERA_STATE.ERROR);
    }
  }

  function start() {
    if (stopped || started || document.hidden) return;
    started = true;
    startTask = requestCamera().finally(() => { startTask = undefined; });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      pause();
    } else if (!retryAllowed && !startTask && stream && tracker) {
      void resume();
    } else {
      start();
    }
  }, {signal: lifetime.signal});

  return {
    start,
    retry() {
      if (stopped || retried || !retryAllowed || document.hidden || startTask) return;
      retried = true;
      retryAllowed = false;
      if (tracker && stream) {
        status(CAMERA_STATE.INITIALIZING);
        void resume();
      } else {
        startTask = requestCamera().finally(() => { startTask = undefined; });
      }
    },
    get gesture() { return {...currentGesture}; },
    stop() {
      if (stopped) return;
      stopped = true;
      lifetime.abort();
      release();
    }
  };
}
