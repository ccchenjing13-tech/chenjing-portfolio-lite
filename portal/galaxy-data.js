// Sample stars, dust and knots in galaxy coordinates, with Z perpendicular to the disk.
export function seededRandom(seed = 137) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(1664525, value) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

const toLinear = channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
const fromSRGB = rgb => rgb.map(toLinear);
const starColors = [
  [0, fromSRGB([1, .81, .48])],
  [.32, fromSRGB([.98, .81, .56])],
  [.62, fromSRGB([.74, .70, .97])],
  [1, fromSRGB([.38, .63, 1])]
];
const outerGold = fromSRGB([1, .75, .46]);
const outerBlue = fromSRGB([.65, .78, 1]);
const armPhases = [0, 1.19, 2.48, 3.74, 5.02];

function armRidge(radius, arm) {
  return armPhases[arm] + radius * .88 + .09 * Math.sin(radius * 1.58 + arm * 2);
}

function armWarp(angle, arm, taper) {
  return .37 * taper * Math.sin(angle * 1.7 + arm);
}

function paint(colors, offset, t, brightness) {
  let stop = 1;
  while (stop < starColors.length - 1 && t > starColors[stop][0]) stop++;
  const [start, a] = starColors[stop - 1];
  const [end, b] = starColors[stop];
  const mix = Math.max(0, Math.min(1, (t - start) / (end - start)));
  for (let channel = 0; channel < 3; channel++) {
    colors[offset + channel] = (a[channel] * (1 - mix) + b[channel] * mix) * brightness;
  }
}

export function generateSpiralBands() {
  const lengthSteps = 144;
  const widthSteps = 10;
  const strata = [0, -.37, .37];
  const vertexCount = armPhases.length * strata.length * (lengthSteps + 1) * (widthSteps + 1);
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const profile = new Float32Array(vertexCount * 4);
  const indices = new Uint16Array(armPhases.length * strata.length * lengthSteps * widthSteps * 6);
  let vertex = 0;
  let index = 0;
  for (let arm = 0; arm < armPhases.length; arm++) {
    for (const stratum of strata) {
      for (let step = 0; step <= lengthSteps; step++) {
        const along = step / lengthSteps;
        const radius = .46 + along * 6.84;
        const ridge = armRidge(radius, arm);
        const taper = Math.sin(Math.PI * radius / 7.3);
        const warp = armWarp(ridge, arm, taper) * .72;
        const width = (.38 + along * .093) * (1 + .10 * Math.sin(radius * 2 + arm));
        for (let across = 0; across <= widthSteps; across++, vertex++) {
          const cross = 2 * across / widthSteps - 1;
          const angle = ridge + cross * width + stratum * .075;
          const z = warp + stratum * taper + cross * .085 * taper;
          positions.set([Math.cos(angle) * radius, Math.sin(angle) * radius, z], vertex * 3);
          paint(colors, vertex * 3, along + cross * .065, 1);
          profile.set([along, cross, armPhases[arm], stratum === 0 ? 1 : .43], vertex * 4);
          if (step > 0 && across > 0) {
            const previous = vertex - widthSteps - 1;
            indices.set([previous - 1, previous, vertex, previous - 1, vertex, vertex - 1], index);
            index += 6;
          }
        }
      }
    }
  }
  return {positions, colors, profile, indices};
}

export function generateGalaxy({count, seed = 137, kind = 'arms'}) {
  const random = seededRandom(seed);
  const gaussian = () => Math.sqrt(-2 * Math.log(Math.max(.000001, random()))) * Math.cos(random() * Math.PI * 2);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const offset = i * 3;
    let radius, angle, height, color, brightness;
    if (kind === 'core' || kind === 'core-glow') {
      const mist = kind === 'core-glow';
      radius = Math.min(2.45, Math.hypot(gaussian(), gaussian()) * (mist ? .55 : .64));
      angle = random() * Math.PI * 2;
      // An oblate, warm stellar bulge remains visible even edge-on.
      height = gaussian() * (.25 + .79 * Math.exp(-radius * .62));
      color = Math.min(.39, radius * .12 + Math.abs(height) * .10);
      brightness = .43 + random() * .82;
      sizes[i] = mist ? 22 + random() ** 2 * 55 : .72 + random() ** 2 * 1.6;
    } else {
      const arm = i % armPhases.length;
      radius = .46 + Math.pow(random(), .80) * 6.84;
      const radialFraction = radius / 7.3;
      const taper = Math.sin(Math.PI * radialFraction);
      const ridge = armRidge(radius, arm);
      const warp = armWarp(ridge, arm, taper);
      const stratum = random() < .37 ? -1 : 1;
      const shelf = warp + stratum * (.22 + .76 * taper);

      if (kind === 'cloud') {
        // Fill each broad lane with overlapping dust on both sides of its bright ridge.
        angle = ridge - .075 + gaussian() * (.17 + radialFraction * .075);
        height = shelf + gaussian() * (.20 + .39 * taper);
        color = Math.max(.08, Math.min(1, radialFraction + gaussian() * .11 + .07));
        brightness = .50 + random() * .57;
        sizes[i] = 23 + random() ** 2 * 42;
      } else if (kind === 'knots') {
        const cluster = Math.floor(random() * 7);
        radius = Math.min(7.42, 4.45 + cluster * .45 + .13 * Math.sin(arm * 3 + cluster) + gaussian() * .12);
        // Knots break up the outer rim so it reads as a spiral, not concentric rings.
        angle = armRidge(radius, arm) + gaussian() * .12;
        height = gaussian() * .22 + stratum * (.37 + .26 * Math.sin(radius * 2.4));
        color = 1;
        brightness = .45 + random() * .75;
        sizes[i] = 1.45 + random() ** 3 * 4.2;
      } else {
        const shoulder = random() < .36;
        const laneWidth = (.129 + radialFraction * .072) * (1 + .15 * Math.sin(radius * 2 + arm));
        angle = ridge + gaussian() * (shoulder ? laneWidth * 2.05 : laneWidth);
        height = (shoulder ? shelf : warp) + gaussian() * (.12 + (shoulder ? .54 : .35) * taper);
        color = Math.max(0, Math.min(1, radialFraction + gaussian() * .075));
        const innerArmGlow = 1 + .35 * Math.exp(-((radius - 2.15) ** 2) / 1.3);
        brightness = innerArmGlow * (shoulder ? .52 : .91) * (.54 + random() * .82);
        sizes[i] = .75 + random() ** 3 * (shoulder ? 2.65 : 2.15);
      }
    }

    positions[offset] = Math.cos(angle) * radius;
    positions[offset + 1] = Math.sin(angle) * radius;
    positions[offset + 2] = Math.max(-2.9, Math.min(2.9, height));
    if (kind === 'knots' && random() < .66) {
      for (let channel = 0; channel < 3; channel++) colors[offset + channel] = outerGold[channel] * brightness;
    } else {
      paint(colors, offset, color, brightness);
    }
    phases[i] = random() * Math.PI * 2;
  }

  return {positions, colors, sizes, phases};
}

export function generateOuterStars(count, seed = 728) {
  const random = seededRandom(seed);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const angle = random() * Math.PI * 2;
    const distance = random() ** 1.7;
    const radius = 7.4 + distance * 5.0;
    const z = (random() + random() + random() - 1.5) * (2.5 + 3 * distance);
    const bright = random() < .085;
    const glow = (bright ? 1.0 : .35 + random() * .45) * (1 - distance * .58);
    const tint = random() < .16 ? outerGold : outerBlue;
    positions.set([Math.cos(angle) * radius, Math.sin(angle) * radius, z], i * 3);
    colors.set(tint.map(channel => channel * glow), i * 3);
    sizes[i] = bright ? 2.3 + random() ** 2 * 3.1 : .68 + random() ** 2 * 1.25;
    phases[i] = random() * Math.PI * 2;
  }

  return {positions, colors, sizes, phases};
}
