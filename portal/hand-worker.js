// A classic Worker lets the MediaPipe WASM loader use importScripts.
let detector, describePalm;

Promise.all([import('./hand-landmarker.js'), import('./gesture-motion.js')]).then(async ([tracker, motion]) => {
  describePalm = motion.describePalm;
  detector = await tracker.loadHandLandmarker();
  self.postMessage({ok: true});
}).catch(() => self.postMessage({ok: false}));

self.onmessage = ({data: {bitmap, timestamp}}) => {
  const start = performance.now();
  try {
    const {landmarks} = detector.detectForVideo(bitmap, timestamp);
    self.postMessage({ok: true, palm: describePalm(landmarks[0], bitmap.width / bitmap.height),
      delegate: 'CPU', inference: performance.now() - start});
  } catch (error) {
    self.postMessage({ok: false, error: error.message});
  } finally {
    bitmap.close();
  }
};
