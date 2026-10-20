import test from "node:test";
import assert from "node:assert/strict";
import {
  Simulation,
  lennardJonesPotential,
  minimumImage,
  shiftedForcePotential,
  shiftedForceRadialForce
} from "../src/md.js";

test("shifted-force Lennard-Jones force matches the negative potential derivative", () => {
  const epsilon = 1.3;
  const sigma = 0.9;
  const cutoff = 2.7;
  const h = 1e-6;
  for (const distance of [0.95, 1.15, 1.5, 2.2]) {
    const derivative = (
      shiftedForcePotential(distance + h, epsilon, sigma, cutoff)
      - shiftedForcePotential(distance - h, epsilon, sigma, cutoff)
    ) / (2 * h);
    assert.ok(Math.abs(derivative + shiftedForceRadialForce(distance, epsilon, sigma, cutoff)) < 1e-6);
  }
  assert.equal(shiftedForcePotential(cutoff, epsilon, sigma, cutoff), 0);
  assert.equal(shiftedForceRadialForce(cutoff, epsilon, sigma, cutoff), 0);
});

test("Lennard-Jones potential is finite and zero at its minimum", () => {
  assert.ok(Math.abs(lennardJonesPotential(2 ** (1 / 6)) + 1) < 1e-12);
});

test("minimum-image convention wraps displacements to the nearest image", () => {
  assert.equal(minimumImage(9, 10), -1);
  assert.equal(minimumImage(-9, 10), 1);
  assert.equal(minimumImage(2, 10), 2);
});

test("initialization is reproducible, has the requested temperature, and avoids overlaps", () => {
  const options = { particleCount: 36, density: 0.5, temperature: 1.1, seed: 47 };
  const first = new Simulation(options);
  const second = new Simulation(options);
  assert.deepEqual(first.positions, second.positions);
  assert.deepEqual(first.velocities, second.velocities);
  assert.ok(Math.abs(first.measure().temperature - 1.1) < 1e-12);
  for (let i = 0; i < first.particleCount; i += 1) {
    for (let j = i + 1; j < first.particleCount; j += 1) {
      const dx = minimumImage(first.positions[i][0] - first.positions[j][0], first.boxLength);
      const dy = minimumImage(first.positions[i][1] - first.positions[j][1], first.boxLength);
      assert.ok(Math.hypot(dx, dy) > 0.5);
    }
  }
});

test("high-density non-square initialization avoids near-overlapping rows", () => {
  const simulation = new Simulation({ particleCount: 10, density: 0.95, temperature: 0.5, cutoff: 1.5, seed: 9 });
  let closestPair = Infinity;
  for (let i = 0; i < simulation.particleCount; i += 1) {
    for (let j = i + 1; j < simulation.particleCount; j += 1) {
      const dx = minimumImage(simulation.positions[i][0] - simulation.positions[j][0], simulation.boxLength);
      const dy = minimumImage(simulation.positions[i][1] - simulation.positions[j][1], simulation.boxLength);
      closestPair = Math.min(closestPair, Math.hypot(dx, dy));
    }
  }
  assert.ok(closestPair > 0.8, `closest initial pair was ${closestPair}`);
});

test("microcanonical total-energy drift decreases when the time step is halved", () => {
  const options = { particleCount: 16, density: 0.3, temperature: 0.5, cutoff: 2.5, seed: 123 };
  function energyDrift(timeStep) {
    const simulation = new Simulation({ ...options, timeStep });
    const initialEnergy = simulation.measure().totalEnergy;
    let maxDeviation = 0;
    for (let step = 0; step < 1200; step += 1) {
      simulation.step();
      if (step % 10 === 0) {
        maxDeviation = Math.max(maxDeviation, Math.abs(simulation.measure().totalEnergy - initialEnergy));
      }
    }
    return maxDeviation;
  }
  const coarseDrift = energyDrift(0.004);
  const fineDrift = energyDrift(0.002);
  assert.ok(fineDrift < coarseDrift * 0.4, `expected ${fineDrift} < ${coarseDrift} * 0.4`);
});

test("measurements, RDF normalization, and diffusion estimate remain finite", () => {
  const simulation = new Simulation({ particleCount: 25, density: 0.35, temperature: 0.7, seed: 4 });
  for (let step = 0; step < 100; step += 1) {
    simulation.step();
    if (step % 10 === 9) simulation.recordMeasurement();
  }
  assert.ok(simulation.measurements.every(sample => Object.values(sample).every(Number.isFinite)));
  assert.equal(simulation.radialDistribution().length, 60);
  assert.ok(simulation.radialDistribution().every(sample => Number.isFinite(sample.g) && sample.g >= 0));
  assert.ok(Number.isFinite(simulation.diffusionEstimate()));
  assert.equal(simulation.trajectoryFrames.length, simulation.measurements.length);
  simulation.startProduction();
  assert.equal(simulation.measurements.length, 1);
  assert.equal(simulation.rdfSamples, 1);
  assert.equal(simulation.trajectoryFrames.length, 1);
});

test("invalid cutoffs and overlapping particles fail explicitly", () => {
  assert.throws(() => new Simulation({ particleCount: 16, density: 0.9, cutoff: 2.5 }), /Cutoff/);
  const simulation = new Simulation({ particleCount: 4, density: 0.2, cutoff: 2 });
  simulation.positions[1] = [...simulation.positions[0]];
  assert.throws(() => simulation.calculateForces(), /overlap/);
});
