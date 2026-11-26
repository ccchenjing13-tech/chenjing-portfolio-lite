import {describePalm} from './gesture-motion.js';

const NORMAL_FRAME_EDGE = 640;
const ECONOMICAL_FRAME_EDGE = 384;
const WORKER_STARTUP_TIMEOUT_MS = 105000;

function frameSize(width, height, edge) {
  const scale = Math.min(1, edge / Math.max(width, height));
  return {resizeWidth: Math.round(width * scale), resizeHeight: Math.round(height * scale)};
}

export async function loadHandLandmarker() {
  const path = new URL('./vendor/mediapipe-0.10.21/', import.meta.url);
  const {FilesetResolver, HandLandmarker} = await import(new URL('vision_bundle.mjs', path).href);
  const assets = await FilesetResolver.forVisionTasks(new URL('wasm', path).href);
  return HandLandmarker.createFromOptions(assets, {
    baseOptions: {modelAssetPath: new URL('hand_landmarker.task', path).href},
    runningMode: 'VIDEO',
    numHands: 1,
    minHandDetectionConfidence: 0.55,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5
  });
}

function openWorker(signal) {
  const worker = new Worker(new URL('./hand-worker.js', import.meta.url));
  let pending, watchdog, timing, closed = false;
  let edge = NORMAL_FRAME_EDGE;
  const close = (reason) => {
    if (closed) return;
    closed = true;
    clearTimeout(watchdog);
    worker.terminate();
    signal.removeEventListener('abort', close);
    pending?.reject(reason instanceof Error || reason instanceof DOMException ? reason : new Error('Hand tracker stopped'));
    pending = undefined;
  };

  const ready = new Promise((resolve, reject) => { pending = {resolve, reject}; });
  // A cold cache must download the WASM and model before the worker can be ready.
  watchdog = setTimeout(() => close(new DOMException('Hand tracker startup timed out', 'TimeoutError')), WORKER_STARTUP_TIMEOUT_MS);
  worker.onmessage = ({data}) => {
    clearTimeout(watchdog);
    const request = pending;
    pending = undefined;
    if (data.ok) request?.resolve(data);
    else request?.reject(new Error(data.error || 'Hand tracker worker failed'));
  };
  worker.onerror = close;
  signal.addEventListener('abort', close, {once: true});

  return ready.then(() => ({
    mode: 'worker',
    setEconomical(enabled) { edge = enabled ? ECONOMICAL_FRAME_EDGE : NORMAL_FRAME_EDGE; },
    get timing() { return timing; },
    async sample(video, timestamp) {
      const captureAt = performance.now();
      let bitmap;
      try {
        bitmap = Math.max(video.videoWidth, video.videoHeight) > edge
          ? await createImageBitmap(video, frameSize(video.videoWidth, video.videoHeight, edge))
          : await createImageBitmap(video);
      } catch {
        bitmap = await createImageBitmap(video);
      }
      const capture = performance.now() - captureAt;
      if (closed) {
        bitmap.close();
        return null;
      }
      const result = await new Promise((resolve, reject) => {
        pending = {resolve, reject};
        try {
          worker.postMessage({bitmap, timestamp}, [bitmap]);
          watchdog = setTimeout(close, 4000);
        } catch (error) {
          bitmap.close();
          pending = undefined;
          reject(error);
        }
      });
      timing = {capture, inference: result.inference, delegate: result.delegate};
      return result.palm;
    },
    close
  }), error => {
    close();
    throw error;
  });
}

export async function openHandTracker(signal) {
  if (typeof Worker === 'function' && typeof createImageBitmap === 'function'
    && typeof OffscreenCanvas === 'function') {
    try { return await openWorker(signal); } catch (error) {
      signal.throwIfAborted();
      // Restarting the same large downloads on the main thread cannot fix a slow network.
      if (error.name === 'TimeoutError') throw error;
    }
  }

  signal.throwIfAborted();
  const detector = await loadHandLandmarker();
  if (signal.aborted) {
    detector.close();
    signal.throwIfAborted();
  }
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  let timing, edge = NORMAL_FRAME_EDGE;
  return {
    mode: 'main',
    setEconomical(enabled) { edge = enabled ? ECONOMICAL_FRAME_EDGE : NORMAL_FRAME_EDGE; },
    get timing() { return timing; },
    sample(video, timestamp) {
      const {resizeWidth, resizeHeight} = frameSize(video.videoWidth, video.videoHeight, edge);
      if (canvas.width !== resizeWidth || canvas.height !== resizeHeight) {
        canvas.width = resizeWidth;
        canvas.height = resizeHeight;
      }
      const start = performance.now();
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const inferenceAt = performance.now();
      const result = detector.detectForVideo(canvas, timestamp);
      timing = {capture: inferenceAt - start, inference: performance.now() - inferenceAt, delegate: 'CPU'};
      return describePalm(result.landmarks[0], canvas.width / canvas.height);
    },
    close() { detector.close(); }
  };
}
