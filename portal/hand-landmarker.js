import {describePalm} from './gesture-motion.js';

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
  let pending, watchdog, closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(watchdog);
    worker.terminate();
    signal.removeEventListener('abort', close);
    pending?.reject(new Error('Hand tracker stopped'));
    pending = undefined;
  };

  const ready = new Promise((resolve, reject) => { pending = {resolve, reject}; });
  watchdog = setTimeout(close, 8000);
  worker.onmessage = ({data}) => {
    clearTimeout(watchdog);
    const request = pending;
    pending = undefined;
    if (data.ok) request?.resolve(data.palm);
    else request?.reject(new Error('Hand tracker worker failed'));
  };
  worker.onerror = close;
  signal.addEventListener('abort', close, {once: true});

  return ready.then(() => ({
    mode: 'worker',
    async sample(video, timestamp) {
      const bitmap = await createImageBitmap(video);
      if (closed) {
        bitmap.close();
        return null;
      }
      return new Promise((resolve, reject) => {
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
    try { return await openWorker(signal); } catch { signal.throwIfAborted(); }
  }

  signal.throwIfAborted();
  const detector = await loadHandLandmarker();
  if (signal.aborted) {
    detector.close();
    signal.throwIfAborted();
  }
  return {
    mode: 'main',
    sample(video, timestamp) {
      const result = detector.detectForVideo(video, timestamp);
      return describePalm(result.landmarks[0], video.videoWidth / video.videoHeight);
    },
    close() { detector.close(); }
  };
}
