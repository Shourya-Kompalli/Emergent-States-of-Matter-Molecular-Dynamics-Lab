import { Simulation, SAMPLE_INTERVAL } from "./md.js";

const palette = ["#83a7d6", "#e4ad68", "#e68472", "#b89ada", "#77c6a5", "#e3d577", "#7db7c8", "#e39bbd"];
const form = document.querySelector("#controls");
const elements = {
  particleCanvas: document.querySelector("#particle-canvas"),
  energy: document.querySelector("#energy-chart"),
  rdf: document.querySelector("#rdf-chart"),
  msd: document.querySelector("#msd-chart"),
  density: document.querySelector("#density-chart"),
  temperature: document.querySelector("#temperature-chart"),
  status: document.querySelector("#status"),
  statusText: document.querySelector("#status-text"),
  progress: document.querySelector("#progress-text"),
  phase: document.querySelector("#phase-tag"),
  error: document.querySelector("#error-message")
};
let simulation;
let state = "ready";
let phase = "idle";
let totalSteps = 0;
let completedSteps = 0;
let animationHandle = 0;
let lastPaint = 0;
let savedRuns = [];
let measurement = null;
let activeParameters = null;

function parametersFromForm() {
  const data = Object.fromEntries(new FormData(form));
  const number = key => Number(data[key]);
  return {
    particleCount: number("particleCount"),
    density: number("density"),
    temperature: number("temperature"),
    epsilon: number("epsilon"),
    sigma: number("sigma"),
    cutoff: number("cutoff"),
    timeStep: number("timeStep"),
    equilibrationSteps: number("equilibrationSteps"),
    productionSteps: number("productionSteps"),
    seed: number("seed")
  };
}

function setStatus(text, nextState = state) {
  state = nextState;
  elements.statusText.textContent = text;
  elements.status.className = `status-line ${state}`;
  document.querySelector("#pause-button").textContent = state === "paused" ? "▶ Resume" : "Ⅱ Pause";
  document.querySelector("#pause-button").disabled = !["running", "paused"].includes(state);
  document.querySelector("#run-button").disabled = ["running", "paused"].includes(state);
}

function showError(message) {
  elements.error.textContent = message;
  elements.error.hidden = false;
}

function clearError() {
  elements.error.hidden = true;
  elements.error.textContent = "";
}

function initialize(options = parametersFromForm()) {
  try {
    clearError();
    cancelAnimationFrame(animationHandle);
    simulation = new Simulation(options);
    activeParameters = options;
    measurement = simulation.measurements.at(-1);
    totalSteps = options.equilibrationSteps + options.productionSteps;
    completedSteps = 0;
    phase = "idle";
    drawAll();
    updateMetrics();
    updateExports();
    elements.phase.textContent = "INITIALIZED";
    elements.progress.textContent = "0 / 0 steps";
    setStatus(`Initialized ${options.particleCount} particles at ρ = ${options.density.toFixed(2)}. Ready to run.`, "ready");
  } catch (error) {
    showError(error.message);
    setStatus("Could not initialize this experiment.", "error");
  }
}

function beginExperiment() {
  try {
    const options = parametersFromForm();
    activeParameters = options;
    const { equilibrationSteps, productionSteps, ...simulationOptions } = options;
    simulation = new Simulation(simulationOptions);
    measurement = simulation.measurements.at(-1);
    totalSteps = equilibrationSteps + productionSteps;
    completedSteps = 0;
    phase = equilibrationSteps > 0 ? "equilibration" : "production";
    if (phase === "production") simulation.startProduction();
    clearError();
    elements.phase.textContent = phase.toUpperCase();
    updateMetrics();
    updateExports();
    setStatus(phase === "equilibration" ? "Equilibrating with velocity rescaling…" : "Production run in progress (NVE)…", "running");
    updateExports();
    cancelAnimationFrame(animationHandle);
    animationHandle = requestAnimationFrame(animate);
  } catch (error) {
    showError(error.message);
    setStatus("Could not start this experiment.", "error");
  }
}

function advanceOneStep() {
  simulation.step();
  completedSteps += 1;
  const options = activeParameters;
  if (phase === "equilibration") {
    simulation.rescaleVelocities();
    if (completedSteps >= options.equilibrationSteps) {
      phase = "production";
      elements.phase.textContent = "PRODUCTION";
      simulation.startProduction();
    }
  } else if (simulation.stepCount % SAMPLE_INTERVAL === 0) {
    measurement = simulation.recordMeasurement();
  }
}

function animate(timestamp) {
  if (state !== "running") return;
  try {
    const stepsPerFrame = Math.max(1, Math.min(200, Math.ceil(simulation.particleCount / 10)));
    for (let i = 0; i < stepsPerFrame && completedSteps < totalSteps; i += 1) advanceOneStep();
    if (timestamp - lastPaint > 50 || completedSteps >= totalSteps) {
      lastPaint = timestamp;
      updateMetrics();
      drawAll();
      elements.progress.textContent = `${completedSteps.toLocaleString()} / ${totalSteps.toLocaleString()} steps`;
      updateExports();
    }
    if (completedSteps >= totalSteps) {
      if (simulation.measurements.at(-1)?.step !== simulation.stepCount) {
        measurement = simulation.recordMeasurement();
      }
      phase = "complete";
      elements.phase.textContent = "COMPLETE";
      updateMetrics();
      drawAll();
      setStatus(`Production complete: ${simulation.particleCount} particles, ${simulation.time.toFixed(2)} reduced time units.`, "complete");
      updateExports();
      return;
    }
    animationHandle = requestAnimationFrame(animate);
  } catch (error) {
    showError(error.message);
    setStatus("The simulation stopped because a numerical error occurred.", "error");
  }
}

function canvasContext(canvas) {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { context, width: rect.width, height: rect.height };
}

function drawParticles() {
  if (!simulation) return;
  const { context: ctx, width, height } = canvasContext(elements.particleCanvas);
  ctx.clearRect(0, 0, width, height);
  const side = Math.min(width, height) * 0.82;
  const left = (width - side) / 2;
  const top = (height - side) / 2;
  ctx.fillStyle = "#121a1a";
  ctx.fillRect(left, top, side, side);
  ctx.strokeStyle = "#33413b";
  ctx.setLineDash([3, 5]);
  ctx.lineWidth = 1;
  ctx.strokeRect(left + 0.5, top + 0.5, side - 1, side - 1);
  ctx.setLineDash([]);
  const scale = side / simulation.boxLength;
  const radius = Math.max(2.2, Math.min(5.5, side / Math.sqrt(simulation.particleCount) * 0.16));
  for (let i = 0; i < simulation.particleCount; i += 1) {
    const [x, y] = simulation.positions[i];
    const px = left + x * scale;
    const py = top + y * scale;
    ctx.beginPath();
    ctx.fillStyle = "#77c6a522";
    ctx.arc(px, py, radius * 2.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = "#c1e887";
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = "#f0f4dd";
    ctx.arc(px - radius * 0.22, py - radius * 0.22, Math.max(0.7, radius * 0.22), 0, Math.PI * 2);
    ctx.fill();
  }
  document.querySelector("#box-caption").textContent = `L = ${simulation.boxLength.toFixed(2)} σ  ·  N = ${simulation.particleCount}`;
}

function drawLineChart(canvas, series, options = {}) {
  const { context: ctx, width, height } = canvasContext(canvas);
  ctx.clearRect(0, 0, width, height);
  const margin = { left: 34, right: 9, top: 8, bottom: 22 };
  const plotWidth = Math.max(1, width - margin.left - margin.right);
  const plotHeight = Math.max(1, height - margin.top - margin.bottom);
  ctx.font = "8px 'DM Mono', monospace";
  ctx.lineWidth = 1;
  const allValues = series.flatMap(item => item.points.map(point => point.y).filter(Number.isFinite));
  const allX = series.flatMap(item => item.points.map(point => point.x).filter(Number.isFinite));
  if (!allValues.length || !allX.length) {
    ctx.fillStyle = "#657269";
    ctx.textAlign = "center";
    ctx.fillText("Run an experiment to generate data", width / 2, height / 2);
    return;
  }
  let minY = options.minY ?? Math.min(0, ...allValues);
  let maxY = options.maxY ?? Math.max(1, ...allValues);
  if (minY === maxY) maxY = minY + 1;
  const minX = options.minX ?? Math.min(0, ...allX);
  let maxX = options.maxX ?? Math.max(...allX);
  if (minX === maxX) maxX = minX + 1;
  const yPad = (maxY - minY) * 0.08;
  minY -= options.minY === undefined ? yPad : 0;
  maxY += options.maxY === undefined ? yPad : 0;
  const x = value => margin.left + ((value - minX) / (maxX - minX)) * plotWidth;
  const y = value => margin.top + plotHeight - ((value - minY) / (maxY - minY)) * plotHeight;
  ctx.strokeStyle = "#273331";
  ctx.fillStyle = "#78857a";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= 3; i += 1) {
    const value = minY + (maxY - minY) * i / 3;
    const row = y(value);
    ctx.beginPath();
    ctx.moveTo(margin.left, row);
    ctx.lineTo(width - margin.right, row);
    ctx.stroke();
    ctx.fillText(options.formatY ? options.formatY(value) : compact(value), margin.left - 5, row);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let i = 0; i <= 2; i += 1) {
    const value = minX + (maxX - minX) * i / 2;
    ctx.fillText(options.formatX ? options.formatX(value) : compact(value), x(value), height - margin.bottom + 6);
  }
  ctx.strokeStyle = "#46534c";
  ctx.beginPath();
  ctx.moveTo(margin.left, margin.top);
  ctx.lineTo(margin.left, height - margin.bottom);
  ctx.lineTo(width - margin.right, height - margin.bottom);
  ctx.stroke();
  for (const item of series) {
    ctx.strokeStyle = item.color;
    ctx.fillStyle = item.color;
    ctx.lineWidth = item.width ?? 1.8;
    ctx.beginPath();
    let started = false;
    for (const point of item.points) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      if (item.points.length === 1 || item.markers) {
        ctx.beginPath();
        ctx.arc(x(point.x), y(point.y), 3.2, 0, Math.PI * 2);
        ctx.fill();
      } else if (!started) {
        ctx.moveTo(x(point.x), y(point.y));
        started = true;
      } else ctx.lineTo(x(point.x), y(point.y));
    }
    if (started) ctx.stroke();
  }
}

function compact(value) {
  if (!Number.isFinite(value)) return "0";
  const absolute = Math.abs(value);
  return absolute >= 100 ? value.toFixed(0) : absolute >= 10 ? value.toFixed(1) : value.toFixed(2);
}

function updateMetrics() {
  if (!simulation) return;
  const current = simulation.measure();
  document.querySelector("#metric-temp").textContent = current.temperature.toFixed(3);
  document.querySelector("#metric-pressure").textContent = current.pressure.toFixed(3);
  document.querySelector("#metric-kinetic").textContent = current.kineticEnergy.toFixed(2);
  document.querySelector("#metric-potential").textContent = current.potentialEnergy.toFixed(2);
  document.querySelector("#diffusion-value").textContent = simulation.diffusionEstimate().toFixed(4);
}

function drawAll() {
  drawParticles();
  if (!simulation) return;
  const measurements = simulation.measurements;
  drawLineChart(elements.energy, [
    { color: "#77c6a5", points: measurements.map(point => ({ x: point.time, y: point.kineticEnergy })) },
    { color: "#e68472", points: measurements.map(point => ({ x: point.time, y: point.potentialEnergy })) },
    { color: "#c1e887", points: measurements.map(point => ({ x: point.time, y: point.totalEnergy })) }
  ], { formatX: value => value.toFixed(1) });
  const rdfSeries = [{ color: "#83a7d6", points: simulation.radialDistribution().map(point => ({ x: point.radius, y: point.g })) }];
  savedRuns.forEach((run, index) => rdfSeries.push({
    color: palette[index % palette.length],
    points: run.rdf.map(point => ({ x: point.radius, y: point.g }))
  }));
  drawLineChart(elements.rdf, rdfSeries, { minY: 0, formatX: value => value.toFixed(1) });
  drawLineChart(elements.msd, [{ color: "#e4ad68", points: measurements.map(point => ({ x: point.time, y: point.msd })) }], { minY: 0, formatX: value => value.toFixed(1) });
  drawComparisons();
}

function drawComparisons() {
  const runs = savedRuns;
  drawLineChart(elements.density, runs.length ? [{ color: "#83a7d6", markers: true, points: runs.map(run => ({ x: run.parameters.density, y: run.averagePressure })) }] : [], {
    minX: 0, maxX: 1, formatX: value => value.toFixed(1)
  });
  drawLineChart(elements.temperature, runs.length ? [{ color: "#e4ad68", markers: true, points: runs.map(run => ({ x: run.parameters.density, y: run.averageTemperature })) }] : [], {
    minY: 0, minX: 0, maxX: 1, formatX: value => value.toFixed(1)
  });
  const legend = document.querySelector("#rdf-legend");
  legend.replaceChildren();
  const currentLegend = document.createElement("span");
  currentLegend.innerHTML = '<i class="key key-rdf"></i>Current run';
  legend.append(currentLegend);
  runs.forEach((run, index) => {
    const item = document.createElement("span");
    const key = document.createElement("i");
    key.className = "key";
    key.style.background = palette[index % palette.length];
    item.append(key, document.createTextNode(run.name));
    legend.append(item);
  });
}

function updateSavedRuns() {
  const container = document.querySelector("#saved-runs");
  container.replaceChildren();
  if (!savedRuns.length) {
    const empty = document.createElement("span");
    empty.className = "empty-runs";
    empty.textContent = "Save a completed run to begin a comparison series.";
    container.append(empty);
  } else {
    savedRuns.forEach((run, index) => {
      const chip = document.createElement("span");
      chip.className = "run-chip";
      const swatch = document.createElement("i");
      swatch.style.background = palette[index % palette.length];
      chip.append(swatch, document.createTextNode(run.name));
      container.append(chip);
    });
  }
  document.querySelector("#run-count").textContent = `${savedRuns.length} saved run${savedRuns.length === 1 ? "" : "s"}`;
  drawComparisons();
  if (simulation) {
    drawLineChart(elements.rdf, [
      { color: "#83a7d6", points: simulation.radialDistribution().map(point => ({ x: point.radius, y: point.g })) },
      ...savedRuns.map((run, index) => ({ color: palette[index % palette.length], points: run.rdf.map(point => ({ x: point.radius, y: point.g })) }))
    ], { minY: 0 });
  }
}

function saveCurrentRun() {
  if (!simulation || state === "running" || state === "paused" || simulation.measurements.length < 2) return;
  const production = simulation.measurements.slice(1);
  if (!production.length) {
    showError("Run at least one production sample before saving a comparison.");
    return;
  }
  const parameters = activeParameters ?? parametersFromForm();
  const mean = key => production.reduce((sum, point) => sum + point[key], 0) / production.length;
  savedRuns.push({
    name: `Run ${savedRuns.length + 1} · T ${mean("temperature").toFixed(2)} · ρ ${parameters.density.toFixed(2)}`,
    parameters,
    averagePressure: mean("pressure"),
    averageTemperature: mean("temperature"),
    rdf: simulation.radialDistribution()
  });
  updateSavedRuns();
}

function updateExports() {
  const ready = Boolean(simulation && simulation.measurements.length);
  document.querySelector("#export-csv-button").disabled = !ready;
  document.querySelector("#export-json-button").disabled = !ready;
  document.querySelector("#save-run-button").disabled = !ready || state !== "complete" || simulation.measurements.length < 2;
}

function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportCsv() {
  if (!simulation) return;
  const columns = ["step", "time", "kineticEnergy", "potentialEnergy", "totalEnergy", "temperature", "pressure", "msd"];
  const rows = simulation.measurements.map(point => columns.map(column => point[column]).join(","));
  const seed = (activeParameters ?? parametersFromForm()).seed;
  download(`md-measurements-seed-${seed}.csv`, `${columns.join(",")}\n${rows.join("\n")}\n`, "text/csv");
}

function exportJson() {
  if (!simulation) return;
  const positions = simulation.positions.map(position => [...position]);
  const content = {
    metadata: {
      model: "2D Lennard-Jones, shifted-force cutoff",
      integrator: "velocity-Verlet",
      units: "reduced Lennard-Jones units",
      boundaryConditions: "periodic square box, minimum-image convention",
      rdfNormalization: "ideal-gas shell counts; two-dimensional circular shells"
    },
    parameters: activeParameters ?? parametersFromForm(),
    boxLength: simulation.boxLength,
    time: simulation.time,
    measurements: simulation.measurements,
    radialDistribution: simulation.radialDistribution(),
    diffusionEstimate: simulation.diffusionEstimate(),
    trajectory: { frames: simulation.trajectoryFrames, finalUnwrappedPositions: simulation.unwrappedPositions, finalVelocities: simulation.velocities },
    comparisons: savedRuns
  };
  const seed = (activeParameters ?? parametersFromForm()).seed;
  download(`md-run-seed-${seed}.json`, JSON.stringify(content, null, 2), "application/json");
}

form.addEventListener("submit", event => {
  event.preventDefault();
  beginExperiment();
});
document.querySelector("#pause-button").addEventListener("click", () => {
  if (state === "running") {
    cancelAnimationFrame(animationHandle);
    setStatus("Simulation paused. Resume to continue this production run.", "paused");
  } else if (state === "paused") {
    setStatus(phase === "equilibration" ? "Equilibration resumed…" : "Production run resumed…", "running");
    animationHandle = requestAnimationFrame(animate);
  }
  updateExports();
});
document.querySelector("#reset-button").addEventListener("click", () => initialize());
document.querySelector("#save-run-button").addEventListener("click", saveCurrentRun);
document.querySelector("#export-csv-button").addEventListener("click", exportCsv);
document.querySelector("#export-json-button").addEventListener("click", exportJson);
window.addEventListener("resize", () => { if (simulation) drawAll(); });
initialize();
