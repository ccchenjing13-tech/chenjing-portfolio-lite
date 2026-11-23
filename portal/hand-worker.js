// A classic Worker lets the MediaPipe WASM loader use importScripts.
let detector, describePalm;

Promise.all([import('./hand-landmarker.js'), import('./gesture-motion.js')]).then(async ([tracker, motion]) => {
  describePalm = motion.describePalm;
  detector = await tracker.loadHandLandmarker();
  self.postMessage({ok: true});
}).catch(() => self.postMessage({ok: false}));

self.onmessage = ({data: {bitmap, timestamp}}) => {
  try {
    const {landmarks} = detector.detectForVideo(bitmap, timestamp);
    self.postMessage({ok: true, palm: describePalm(landmarks[0], bitmap.width / bitmap.height)});
  } catch {
    self.postMessage({ok: false});
  } finally {
    bitmap.close();
  }
};
