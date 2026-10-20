# Molecular Dynamics Lab

A reproducible, local, browser-based two-dimensional molecular dynamics experiment. It requires Node.js 18 or newer and has no third-party runtime dependencies.

## Start the application

1. Open a terminal in this project directory.
2. In PowerShell, run `npm.cmd start` (`npm start` also works from Command Prompt).
3. Open <http://127.0.0.1:4173>.
4. Set the particle count, number density, initial temperature, interaction parameters, timestep, and run lengths; select **Run experiment**.
5. Save completed runs to compare their radial distribution functions, mean pressure, and measured temperature. Export measurements as CSV or complete run data as JSON.

Each run uses its displayed integer seed. Repeating the same seed and parameters reproduces the same initial positions and velocities. Equilibration uses velocity rescaling to approach the target temperature; production then proceeds without a thermostat (NVE). Production measurements, RDF accumulation, and trajectory frames start after equilibration. The force and potential use the documented shifted-force Lennard–Jones cutoff. The cutoff must not exceed half the box length. Trajectory frames are sampled at the same interval as the measurement data.

## Tests and numerical validation

Run `npm.cmd test` in PowerShell (`npm test` from Command Prompt) to verify:

- Numerical force/potential derivative agreement and continuity at the cutoff.
- Minimum-image distances, deterministic initialization, and temperature scaling.
- Finite observables, RDF output, and diffusion estimation.
- Microcanonical total-energy drift improvement when the timestep is halved.

The energy-conservation check uses a short, low-density NVE trajectory where the timestep comparison is stable and practical.

## Model and interpretation

The code uses Lennard–Jones reduced units with particle mass and Boltzmann constant set to one. Temperature is computed from the two-dimensional kinetic energy with center-of-mass degrees of freedom removed; pressure uses the two-dimensional virial expression. The radial distribution function is normalized by ideal-gas counts in two-dimensional circular shells and uses minimum-image pair distances up to half the box length. Mean-squared displacement uses unwrapped coordinates; the reported two-dimensional diffusion estimate is one quarter of a linear-fit slope over the latter half of the recorded samples.

This finite-size, classical, two-dimensional model is a teaching tool, not a molecular model of water. It omits water's molecular geometry and directional hydrogen bonding, and does not reproduce the full water phase diagram or experimental water properties. Pressure, transport, and structural estimates depend on system size, sampling length, and equilibration. Simple velocity rescaling is not a rigorous canonical thermostat.

## Files

- `src/md.js` — seeded simulation engine, shifted-force LJ model, velocity-Verlet, observables, and RDF.
- `src/app.js` — interactive controls, animation, charts, comparisons, and export.
- `tests/md.test.js` — automated scientific and numerical checks.
- `server.js` — small local static-file server.


OR SIMPLY JUST IN THIS PROJECT DIRECTORY npm.cmd.start in terminal and follow the link.
