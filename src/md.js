export const RDF_BINS = 60;
export const SAMPLE_INTERVAL = 10;

export function minimumImage(displacement, boxLength) {
  return displacement - boxLength * Math.round(displacement / boxLength);
}

export function lennardJonesPotential(distance, epsilon = 1, sigma = 1) {
  if (!(distance > 0)) throw new RangeError("Particle separation must be greater than zero.");
  const ratio6 = (sigma / distance) ** 6;
  return 4 * epsilon * (ratio6 * ratio6 - ratio6);
}

export function lennardJonesRadialForce(distance, epsilon = 1, sigma = 1) {
  if (!(distance > 0)) throw new RangeError("Particle separation must be greater than zero.");
  const ratio6 = (sigma / distance) ** 6;
  return (24 * epsilon / distance) * (2 * ratio6 * ratio6 - ratio6);
}

export function shiftedForcePotential(distance, epsilon, sigma, cutoff) {
  if (!(distance > 0)) throw new RangeError("Particle separation must be greater than zero.");
  if (distance >= cutoff) return 0;
  const cutoffPotential = lennardJonesPotential(cutoff, epsilon, sigma);
  const cutoffDerivative = -lennardJonesRadialForce(cutoff, epsilon, sigma);
  return lennardJonesPotential(distance, epsilon, sigma)
    - cutoffPotential
    - (distance - cutoff) * cutoffDerivative;
}

export function shiftedForceRadialForce(distance, epsilon, sigma, cutoff) {
  if (!(distance > 0)) throw new RangeError("Particle separation must be greater than zero.");
  if (distance >= cutoff) return 0;
  return lennardJonesRadialForce(distance, epsilon, sigma)
    - lennardJonesRadialForce(cutoff, epsilon, sigma);
}

function gaussian(random) {
  const u1 = Math.max(random(), Number.EPSILON);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * random());
}

export class Simulation {
  constructor({
    particleCount = 64,
    density = 0.45,
    temperature = 0.8,
    epsilon = 1,
    sigma = 1,
    cutoff = 2.5,
    timeStep = 0.004,
    seed = 1
  } = {}) {
    this.validateParameters({ particleCount, density, temperature, epsilon, sigma, cutoff, timeStep });
    this.particleCount = particleCount;
    this.density = density;
    this.temperatureTarget = temperature;
    this.epsilon = epsilon;
    this.sigma = sigma;
    this.cutoff = cutoff;
    this.timeStep = timeStep;
    this.boxLength = Math.sqrt(particleCount / density);
    this.random = this.createRandom(seed);
    this.positions = this.initializePositions();
    this.unwrappedPositions = this.positions.map(position => [...position]);
    this.velocities = this.initializeVelocities(temperature);
    this.forces = this.calculateForces().forces;
    this.stepCount = 0;
    this.time = 0;
    this.measurements = [];
    this.rdfCounts = new Float64Array(RDF_BINS);
    this.rdfSamples = 0;
    this.trajectoryFrames = [];
    this.recordMeasurement();
  }

  static validateParameters(parameters) {
    const { particleCount, density, temperature, epsilon, sigma, cutoff, timeStep } = parameters;
    if (!Number.isInteger(particleCount) || particleCount < 4 || particleCount > 400) {
      throw new RangeError("Particle count must be an integer from 4 to 400.");
    }
    if (!Number.isFinite(density) || density < 0.05 || density > 0.95) {
      throw new RangeError("Density must be between 0.05 and 0.95 particles per unit area.");
    }
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 5) {
      throw new RangeError("Temperature must be between 0 and 5 in reduced units.");
    }
    if (!Number.isFinite(epsilon) || epsilon <= 0 || epsilon > 5
      || !Number.isFinite(sigma) || sigma <= 0 || sigma > 3) {
      throw new RangeError("Epsilon must be in (0, 5] and sigma in (0, 3].");
    }
    const boxLength = Math.sqrt(particleCount / density);
    if (!Number.isFinite(cutoff) || cutoff <= 0 || cutoff > boxLength / 2) {
      throw new RangeError("Cutoff must be positive and no greater than half the box length.");
    }
    if (!Number.isFinite(timeStep) || timeStep <= 0 || timeStep > 0.02) {
      throw new RangeError("Time step must be positive and no greater than 0.02.");
    }
  }

  validateParameters(parameters) {
    Simulation.validateParameters(parameters);
  }

  createRandom(seed) {
    let state = seed >>> 0;
    return () => {
      state += 0x6D2B79F5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  initializePositions() {
    const columns = Math.max(1, Math.floor(Math.sqrt(this.particleCount)));
    const rows = Math.ceil(this.particleCount / columns);
    const spacingX = this.boxLength / columns;
    const spacingY = this.boxLength / rows;
    const positions = [];
    for (let i = 0; i < this.particleCount; i += 1) {
      const x = i % columns;
      const y = Math.floor(i / columns);
      const jitterX = spacingX * 0.08;
      const jitterY = spacingY * 0.08;
      positions.push([
        ((x + 0.5) * spacingX + (y % 2) * spacingX / 2 + (this.random() - 0.5) * jitterX + this.boxLength) % this.boxLength,
        ((y + 0.5) * spacingY + (this.random() - 0.5) * jitterY + this.boxLength) % this.boxLength
      ]);
    }
    return positions;
  }

  initializeVelocities(temperature) {
    const velocities = Array.from({ length: this.particleCount }, () => [gaussian(this.random), gaussian(this.random)]);
    const centerOfMass = [0, 0];
    for (const velocity of velocities) {
      centerOfMass[0] += velocity[0] / this.particleCount;
      centerOfMass[1] += velocity[1] / this.particleCount;
    }
    for (const velocity of velocities) {
      velocity[0] -= centerOfMass[0];
      velocity[1] -= centerOfMass[1];
    }
    this.rescaleVelocities(velocities, temperature);
    return velocities;
  }

  rescaleVelocities(velocities = this.velocities, temperature = this.temperatureTarget) {
    const kineticEnergy = velocities.reduce((sum, velocity) => sum + 0.5 * (velocity[0] ** 2 + velocity[1] ** 2), 0);
    const degreesOfFreedom = Math.max(1, 2 * this.particleCount - 2);
    if (temperature === 0 || kineticEnergy === 0) {
      for (const velocity of velocities) velocity[0] = velocity[1] = 0;
      return;
    }
    const scale = Math.sqrt((degreesOfFreedom * temperature / 2) / kineticEnergy);
    for (const velocity of velocities) {
      velocity[0] *= scale;
      velocity[1] *= scale;
    }
  }

  calculateForces() {
    const forces = Array.from({ length: this.particleCount }, () => [0, 0]);
    let potentialEnergy = 0;
    let virial = 0;
    const cutoffSquared = this.cutoff ** 2;
    for (let i = 0; i < this.particleCount; i += 1) {
      for (let j = i + 1; j < this.particleCount; j += 1) {
        const dx = minimumImage(this.positions[i][0] - this.positions[j][0], this.boxLength);
        const dy = minimumImage(this.positions[i][1] - this.positions[j][1], this.boxLength);
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared >= cutoffSquared) continue;
        if (distanceSquared < 1e-12) throw new RangeError("Particles overlap; force is undefined.");
        const distance = Math.sqrt(distanceSquared);
        const radialForce = shiftedForceRadialForce(distance, this.epsilon, this.sigma, this.cutoff);
        const scale = radialForce / distance;
        const fx = scale * dx;
        const fy = scale * dy;
        forces[i][0] += fx;
        forces[i][1] += fy;
        forces[j][0] -= fx;
        forces[j][1] -= fy;
        potentialEnergy += shiftedForcePotential(distance, this.epsilon, this.sigma, this.cutoff);
        virial += dx * fx + dy * fy;
      }
    }
    return { forces, potentialEnergy, virial };
  }

  step() {
    const halfStep = 0.5 * this.timeStep;
    for (let i = 0; i < this.particleCount; i += 1) {
      const dx = this.velocities[i][0] * this.timeStep + this.forces[i][0] * halfStep * this.timeStep;
      const dy = this.velocities[i][1] * this.timeStep + this.forces[i][1] * halfStep * this.timeStep;
      this.unwrappedPositions[i][0] += dx;
      this.unwrappedPositions[i][1] += dy;
      this.positions[i][0] = ((this.positions[i][0] + dx) % this.boxLength + this.boxLength) % this.boxLength;
      this.positions[i][1] = ((this.positions[i][1] + dy) % this.boxLength + this.boxLength) % this.boxLength;
      this.velocities[i][0] += this.forces[i][0] * halfStep;
      this.velocities[i][1] += this.forces[i][1] * halfStep;
    }
    const result = this.calculateForces();
    for (let i = 0; i < this.particleCount; i += 1) {
      this.velocities[i][0] += result.forces[i][0] * halfStep;
      this.velocities[i][1] += result.forces[i][1] * halfStep;
    }
    this.forces = result.forces;
    this.stepCount += 1;
    this.time = this.stepCount * this.timeStep;
    return result;
  }

  measure() {
    const { potentialEnergy, virial } = this.calculateForces();
    const kineticEnergy = this.velocities.reduce((sum, velocity) => sum + 0.5 * (velocity[0] ** 2 + velocity[1] ** 2), 0);
    const temperature = 2 * kineticEnergy / (2 * this.particleCount - 2);
    const pressure = this.density * temperature + virial / (2 * this.boxLength ** 2);
    const msd = this.unwrappedPositions.reduce((sum, position, i) => {
      const dx = position[0] - this.initialUnwrappedPositions[i][0];
      const dy = position[1] - this.initialUnwrappedPositions[i][1];
      return sum + dx * dx + dy * dy;
    }, 0) / this.particleCount;
    return { step: this.stepCount, time: this.time, kineticEnergy, potentialEnergy, totalEnergy: kineticEnergy + potentialEnergy, temperature, pressure, msd };
  }

  recordMeasurement() {
    if (!this.initialUnwrappedPositions) {
      this.initialUnwrappedPositions = this.unwrappedPositions.map(position => [...position]);
    }
    const measurement = this.measure();
    this.measurements.push(measurement);
    this.accumulateRdf();
    this.trajectoryFrames.push({
      step: this.stepCount,
      time: this.time,
      positions: this.positions.map(position => [...position])
    });
    return measurement;
  }

  startProduction() {
    this.measurements = [];
    this.rdfCounts.fill(0);
    this.rdfSamples = 0;
    this.trajectoryFrames = [];
    this.initialUnwrappedPositions = this.unwrappedPositions.map(position => [...position]);
    return this.recordMeasurement();
  }

  accumulateRdf() {
    const maxRadius = this.boxLength / 2;
    const binWidth = maxRadius / RDF_BINS;
    for (let i = 0; i < this.particleCount; i += 1) {
      for (let j = i + 1; j < this.particleCount; j += 1) {
        const dx = minimumImage(this.positions[i][0] - this.positions[j][0], this.boxLength);
        const dy = minimumImage(this.positions[i][1] - this.positions[j][1], this.boxLength);
        const distance = Math.hypot(dx, dy);
        const bin = Math.floor(distance / binWidth);
        if (bin < RDF_BINS) this.rdfCounts[bin] += 1;
      }
    }
    this.rdfSamples += 1;
  }

  radialDistribution() {
    const maxRadius = this.boxLength / 2;
    const binWidth = maxRadius / RDF_BINS;
    return Array.from(this.rdfCounts, (count, index) => {
      const inner = index * binWidth;
      const outer = inner + binWidth;
      const shellArea = Math.PI * (outer * outer - inner * inner);
      const expectedPairs = this.rdfSamples * this.particleCount * this.density * shellArea / 2;
      return { radius: (inner + outer) / 2, g: expectedPairs > 0 ? count / expectedPairs : 0 };
    });
  }

  diffusionEstimate() {
    const samples = this.measurements.slice(Math.floor(this.measurements.length / 2));
    if (samples.length < 2) return 0;
    const meanTime = samples.reduce((sum, sample) => sum + sample.time, 0) / samples.length;
    const meanMsd = samples.reduce((sum, sample) => sum + sample.msd, 0) / samples.length;
    let covariance = 0;
    let variance = 0;
    for (const sample of samples) {
      covariance += (sample.time - meanTime) * (sample.msd - meanMsd);
      variance += (sample.time - meanTime) ** 2;
    }
    return variance > 0 ? covariance / variance / 4 : 0;
  }
}
