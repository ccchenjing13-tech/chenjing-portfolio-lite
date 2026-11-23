import * as THREE from './vendor/three-r180/three.module.min.js';
import {generateGalaxy, generateOuterStars, generateSpiralBands, seededRandom} from './galaxy-data.js';
import {createGalaxyRotation, dragToRotation} from './galaxy-rotation.js';
import {GESTURE_CONFIG} from './gesture-motion.js';

const FRAMING_RADIUS = 8.1;
const WIDE_CAMERA_DISTANCE = 22.6;

const vertexShader = `
  attribute float aSize;
  attribute float aPhase;
  uniform float uScale;
  uniform float uTime;
  uniform float uCameraDistance;
  uniform float uDepthContrast;
  varying vec3 vColor;
  varying float vPulse;
  void main(){
    vColor = color;
    vec4 mv = modelViewMatrix*vec4(position,1.);
    float depth = clamp((uCameraDistance + mv.z) / 7.6, -1., 1.);
    vPulse = (.92 + .08*sin(uTime*.55+aPhase)) * (1. + depth*uDepthContrast);
    gl_Position = projectionMatrix*mv;
    gl_PointSize = clamp(aSize*uScale*(22./max(1.,-mv.z)),1.,240.);
  }
`;
const fragmentShader = `
  uniform float uOpacity;
  uniform float uSoft;
  varying vec3 vColor;
  varying float vPulse;
  void main(){
    float radius = length(gl_PointCoord-.5)*2.;
    if(radius>1.) discard;
    float glow = exp(-radius*radius*uSoft)*(1.-smoothstep(.75,1.,radius));
    gl_FragColor = vec4(vColor,glow*uOpacity*vPulse);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function createSpiralBands() {
  const mesh = generateSpiralBands();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(mesh.colors, 3));
  geometry.setAttribute('aProfile', new THREE.BufferAttribute(mesh.profile, 4));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  const material = new THREE.ShaderMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexShader: `
      attribute vec4 aProfile;
      varying vec4 vProfile;
      varying vec3 vColor;
      varying float vExposure;
      void main() {
        vProfile = aProfile;
        vColor = color;
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.);
        vec3 diskNormal = normalize(normalMatrix * vec3(0., 0., 1.));
        float facing = abs(dot(diskNormal, normalize(-viewPosition.xyz)));
        vExposure = mix(.25, 1., smoothstep(.025, .28, facing));
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      varying vec4 vProfile;
      varying vec3 vColor;
      varying float vExposure;
      void main() {
        float along = vProfile.x;
        float across = vProfile.y;
        float phase = vProfile.z;
        float profile = exp(-across * across * 2.9) * (1. - smoothstep(.68, 1., abs(across)));
        float taper = mix(.35, 1., smoothstep(.0, .15, along)) * (1. - smoothstep(.83, 1., along));
        float dust = .80 + .13*sin(along*38. + across*7. + phase)
                         + .07*sin(along*98. - across*11. + phase);
        gl_FragColor = vec4(vColor, .34 * profile * taper * dust * vProfile.w * vExposure);
        #include <colorspace_fragment>
      }
    `
  });
  return new THREE.Mesh(geometry, material);
}

function createGalaxyNucleus() {
  const geometry = new THREE.SphereGeometry(1, 36, 24);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexShader: `
      varying vec3 vLocalPosition;
      varying vec3 vLocalCamera;
      void main() {
        vLocalPosition = position;
        vLocalCamera = (inverse(modelMatrix) * vec4(cameraPosition, 1.)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }
    `,
    fragmentShader: `
      varying vec3 vLocalPosition;
      varying vec3 vLocalCamera;
      void main() {
        vec3 ray = normalize(vLocalPosition - vLocalCamera);
        vec3 axisDistance = cross(vLocalCamera, ray);
        float radius2 = dot(axisDistance, axisDistance);
        float hot = exp(-radius2 * 26.);
        float body = exp(-radius2 * 6.8);
        float halo = exp(-radius2 * 2.4) * (1. - smoothstep(.48, 1., radius2));
        vec3 warm = mix(vec3(1., .46, .12), vec3(1., .96, .78), clamp(body * .74 + hot * .32, 0., 1.));
        gl_FragColor = vec4(warm, min(.97, .79 * hot + .49 * body + .21 * halo));
        #include <colorspace_fragment>
      }
    `
  });
  const nucleus = new THREE.Mesh(geometry, material);
  nucleus.scale.set(1.52, 1.35, 1.16);
  return nucleus;
}

export function createGalaxy(container, {onFrame = () => {}, onManualInput = () => {}} = {}) {
  const mobile = window.matchMedia('(max-width:640px)').matches;
  const motion = window.matchMedia('(prefers-reduced-motion:reduce)');
  const controller = new AbortController();
  const signal = controller.signal;
  const renderer = new THREE.WebGLRenderer({alpha:true,antialias:false,powerPreference:'default'});
  renderer.setClearColor(0x050817,0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute('aria-hidden','true');
  container.append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34,1,.1,100);
  camera.position.z = WIDE_CAMERA_DISTANCE;
  const pivot = new THREE.Group();
  const disk = new THREE.Group();
  pivot.rotation.set(-1.15, 0, .06, 'ZXY');
  pivot.position.y = -.10;
  disk.scale.x = 1.10;
  const rotation = createGalaxyRotation(pivot.quaternion);
  const diskNormal = new THREE.Vector3();
  const initialDiskNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(pivot.quaternion);
  const initialPitch = Math.atan2(-initialDiskNormal.y, initialDiskNormal.z);
  const minGesturePitch = Math.max(GESTURE_CONFIG.minPitch, -GESTURE_CONFIG.maxAbsolutePitch - initialPitch);
  const maxGesturePitch = Math.min(GESTURE_CONFIG.maxPitch, GESTURE_CONFIG.maxAbsolutePitch - initialPitch);
  pivot.add(disk);scene.add(pivot);
  let width=1,height=1,scale=1,quality=mobile?1:1.4;
  const materials=[];
  const resources=[];
  const bands = createSpiralBands();
  resources.push(bands.geometry, bands.material);
  disk.add(bands);
  const nucleus = createGalaxyNucleus();
  resources.push(nucleus.geometry, nucleus.material);
  disk.add(nucleus);
  const pointsFor = (data,{opacity=1,soft=4.5,depthContrast=.36}={}) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(data.positions,3));
    geometry.setAttribute('color',new THREE.BufferAttribute(data.colors,3));
    geometry.setAttribute('aSize',new THREE.BufferAttribute(data.sizes,1));
    geometry.setAttribute('aPhase',new THREE.BufferAttribute(data.phases,1));
    const material = new THREE.ShaderMaterial({vertexShader,fragmentShader,vertexColors:true,
      uniforms:{uScale:{value:1},uTime:{value:0},uOpacity:{value:opacity},uSoft:{value:soft},
        uCameraDistance:{value:camera.position.z},uDepthContrast:{value:depthContrast}},
      transparent:true,depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending,toneMapped:false});
    materials.push(material);resources.push(geometry,material);
    return new THREE.Points(geometry,material);
  };
  disk.add(
    pointsFor(generateGalaxy({count:mobile?31500:60000}),{opacity:.94}),
    pointsFor(generateGalaxy({count:mobile?5100:10400,kind:'core',seed:991}),{opacity:.88,soft:5.4}),
    pointsFor(generateGalaxy({count:mobile?170:320,kind:'core-glow',seed:870}),{opacity:.047,soft:4.5}),
    pointsFor(generateGalaxy({count:mobile?1050:2100,kind:'cloud',seed:330}),{opacity:.081,soft:3.7,depthContrast:.54}),
    pointsFor(generateGalaxy({count:mobile?620:1220,kind:'knots',seed:162}),{opacity:.91,soft:3.6,depthContrast:.52}),
    pointsFor(generateOuterStars(mobile?820:1750),{opacity:.82,soft:3.6,depthContrast:.47})
  );
  const random=seededRandom(98);
  const field={positions:new Float32Array(620*3),colors:new Float32Array(620*3),sizes:new Float32Array(620),phases:new Float32Array(620)};
  for(let i=0;i<620;i++){
    field.positions[i*3]=(random()-.5)*60;
    field.positions[i*3+1]=(random()-.5)*38;
    field.positions[i*3+2]=-5-random()*22;
    field.colors.set([.22+random()*.22,.29+random()*.25,.48+random()*.3],i*3);
    field.sizes[i]=.8+random()**4*2.6;field.phases[i]=random()*6.28;
  }
  const stars=pointsFor(field,{opacity:.65,depthContrast:0});scene.add(stars);
  let yawVelocity = 0;
  let pitchVelocity = 0;
  let controlMode = 'interactive';
  let baseCameraDistance = camera.position.z;
  let flightOrigin, flightEnd;
  let gestureHasControl = false;
  let manualUntil = 0;
  let pointer=null,lastX=0,lastY=0,lastT=0,previousTime=0,elapsed=0,frame=0,disposed=false,active=true;
  const clamp=THREE.MathUtils.clamp;
  const canAcceptGesture = () => !disposed && active && controlMode === 'interactive'
    && pointer === null && performance.now() >= manualUntil;

  function useManualInput() {
    onManualInput();
    if (gestureHasControl) rotation.hold();
    gestureHasControl = false;
    manualUntil = performance.now() + 200;
  }
  function updateCameraDistance() {
    for (const material of materials) material.uniforms.uCameraDistance.value = camera.position.z;
  }

  const resize=()=>{
    const box=container.getBoundingClientRect();width=Math.max(1,box.width);height=Math.max(1,box.height);
    scale=Math.min(window.devicePixelRatio||1,quality,Math.sqrt(2800000/(width*height)));
    renderer.setPixelRatio(scale);renderer.setSize(width,height,false);
    camera.aspect=width/height;
    // Fit the widest orientation on mobile and keep a closer view in landscape.
    const halfFrustum = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const horizontalFrustum = halfFrustum * camera.aspect;
    const horizontalFit = Math.hypot(FRAMING_RADIUS, FRAMING_RADIUS / horizontalFrustum);
    baseCameraDistance = Math.max(WIDE_CAMERA_DISTANCE, horizontalFit);
    if (controlMode === 'interactive') {
      camera.position.z = baseCameraDistance;
      updateCameraDistance();
    }
    camera.updateProjectionMatrix();
    for (const material of materials) {
      // Match point sprite size to the galaxy's apparent size on narrow screens.
      material.uniforms.uScale.value = (height / 900) * scale * baseCameraDistance / WIDE_CAMERA_DISTANCE;
    }
  };
  const observer=new ResizeObserver(resize);observer.observe(container);resize();
  function down(event){
    if(controlMode !== 'interactive' || pointer!==null || (event.pointerType==='mouse'&&event.button!==0))return;
    useManualInput();
    pointer=event.pointerId;lastX=event.clientX;lastY=event.clientY;lastT=performance.now();
    yawVelocity = pitchVelocity = 0;
    container.setPointerCapture(pointer);
  }
  function move(event){
    if(event.pointerId!==pointer)return;
    const now = performance.now();
    const deltaSeconds = Math.max(.008, (now - lastT) / 1000);
    const {yaw, pitch} = dragToRotation(event.clientX - lastX, event.clientY - lastY, width, height);
    rotation.turn(yaw, pitch);
    if (!motion.matches) {
      yawVelocity = clamp(yaw / deltaSeconds, -2.7, 2.7);
      pitchVelocity = clamp(pitch / deltaSeconds, -1.5, 1.5);
    }
    lastX=event.clientX;lastY=event.clientY;lastT=now;
  }
  function up(event){
    if(event.pointerId!==pointer)return;
    useManualInput();
    if (event.type !== 'pointerup' || performance.now() - lastT > 100) {
      yawVelocity = pitchVelocity = 0;
    }
    const id=pointer;pointer=null;
    if(container.hasPointerCapture(id))container.releasePointerCapture(id);
  }
  container.addEventListener('pointerdown',down,{signal});
  container.addEventListener('pointermove',move,{signal});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])container.addEventListener(type,up,{signal});
  const keyboardStep = Math.PI / 12;
  const keyboardTurns = new Map([
    ['ArrowLeft', [-keyboardStep, 0]],
    ['ArrowRight', [keyboardStep, 0]],
    ['ArrowUp', [0, -keyboardStep]],
    ['ArrowDown', [0, keyboardStep]]
  ]);
  container.addEventListener('keydown', event => {
    if (controlMode !== 'interactive' || pointer !== null) return;
    const turn = keyboardTurns.get(event.key);
    const reset = event.key.toLowerCase() === 'r';
    if (!turn && !reset) return;
    event.preventDefault();
    useManualInput();
    yawVelocity = pitchVelocity = 0;
    if (reset) {
      rotation.reset();
      elapsed = 0;
    } else {
      rotation.turn(...turn);
    }
  }, {signal});
  function tick(time){
    if(disposed||!active)return;
    const dt=Math.min(.05,previousTime?(time-previousTime)/1000:1/60);previousTime=time;
    if(!motion.matches && controlMode === 'interactive')elapsed+=dt;
    if (motion.matches) {
      yawVelocity = pitchVelocity = 0;
    } else if (pointer === null && (yawVelocity || pitchVelocity)) {
      const damping = Math.exp(-dt * 6);
      const travel = (1 - damping) / 6;
      rotation.turn(yawVelocity * travel, pitchVelocity * travel);
      yawVelocity = Math.abs(yawVelocity * damping) < .001 ? 0 : yawVelocity * damping;
      pitchVelocity = Math.abs(pitchVelocity * damping) < .001 ? 0 : pitchVelocity * damping;
    }
    rotation.update(dt, motion.matches, gestureHasControl ? GESTURE_CONFIG.rotationResponse : undefined);
    pivot.quaternion.copy(rotation.orientation);
    disk.rotation.z = elapsed * .012;
    diskNormal.set(0, 0, 1).applyQuaternion(pivot.quaternion);
    stars.rotation.y = (diskNormal.x - initialDiskNormal.x) * .034;
    stars.rotation.x = (diskNormal.y - initialDiskNormal.y) * -.020;
    for(const m of materials)m.uniforms.uTime.value=elapsed;
    try {
      onFrame(time);
      if (!disposed) {
        renderer.render(scene,camera);
        frame=requestAnimationFrame(tick);
      }
    } catch (cause) {
      console.error('Planet Portal render interrupted:', cause);
      error('三维显示暂时中断，仍可直接进入网站。');
    }
  }
  const error=(message)=>container.dispatchEvent(new CustomEvent('galaxy-error',{detail:message}));
  renderer.domElement.addEventListener('webglcontextlost',event=>{
    event.preventDefault();active=false;cancelAnimationFrame(frame);
    error('三维显示暂时中断，仍可直接进入网站。');
  },{signal});
  document.addEventListener('visibilitychange',()=>{
    active=!document.hidden;
    if(!active)cancelAnimationFrame(frame);
    else{previousTime=0;frame=requestAnimationFrame(tick);}
  },{signal});
  function dispose() {
    if (disposed) return;
    disposed = true;
    active = false;
    cancelAnimationFrame(frame);
    controller.abort();
    observer.disconnect();
    resources.forEach(resource => resource.dispose());
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  }
  try {
    renderer.compile(scene,camera);
    renderer.render(scene,camera);
    frame=requestAnimationFrame(tick);
  } catch (cause) {
    dispose();
    throw cause;
  }
  return {
    canAcceptGesture,
    rotateFromGesture(yaw, pitch = 0) {
      if (!canAcceptGesture()
        || !Number.isFinite(yaw) || !Number.isFinite(pitch) || (!yaw && !pitch)) return;
      if (!gestureHasControl) rotation.hold();
      gestureHasControl = true;
      yawVelocity = pitchVelocity = 0;
      rotation.turnGesture(yaw, pitch, minGesturePitch, maxGesturePitch);
    },
    beginFlythrough(pastCoreDistance) {
      if (disposed || controlMode === 'traverse') return null;
      controlMode = 'traverse';
      if (pointer !== null) {
        const id = pointer;
        pointer = null;
        if (container.hasPointerCapture(id)) container.releasePointerCapture(id);
      }
      yawVelocity = pitchVelocity = 0;
      gestureHasControl = false;
      rotation.hold();
      flightOrigin = camera.position.clone();
      const core = pivot.position.clone();
      const forward = core.clone().sub(flightOrigin).normalize();
      flightEnd = core.clone().addScaledVector(forward, pastCoreDistance);
      const screenCore = core.project(camera);
      return {x: (screenCore.x + 1) * 50, y: (1 - screenCore.y) * 50};
    },
    flyThroughTo(progress) {
      camera.position.lerpVectors(flightOrigin, flightEnd, progress);
      updateCameraDistance();
    },
    dispose
  };
}
