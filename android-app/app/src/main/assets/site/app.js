const BUNDLED_HOSTS = new Set(["appassets.androidplatform.net"]);
const OFFLINE_BOOTSTRAP_PATH = "./data/bootstrap.json";
const OFFLINE_COMPOUNDS_PATH = "./data/offline_compounds.json";
const OFFLINE_FORMULA_PATTERN = /^[A-Za-z0-9()[\]{}.+\-·]+$/;

const state = {
  elements: [],
  elementsBySymbol: new Map(),
  library: [],
  offlineBootstrap: null,
  offlineCompounds: [],
  offlineCompoundsByCid: new Map(),
  offlineQueryIndex: new Map(),
  currentCompound: null,
  currentElement: null,
  highlightedSymbols: new Set(),
  viewer: null,
  currentSdf: "",
  surfaceVisible: false,
  atomFrameId: null,
  atomCanvas: null,
  periodicView: "matrix",
  mobileView: "search",
};

const refs = {
  elementCount: document.querySelector("#element-count"),
  libraryCount: document.querySelector("#library-count"),
  compoundQuery: document.querySelector("#compound-query"),
  compoundSearchForm: document.querySelector("#compound-search-form"),
  useFormulaButton: document.querySelector("#use-formula-button"),
  statusBanner: document.querySelector("#status-banner"),
  exampleChips: document.querySelector("#example-chips"),
  compoundName: document.querySelector("#compound-name"),
  compoundFormula: document.querySelector("#compound-formula"),
  compoundMessage: document.querySelector("#compound-message"),
  summaryBadges: document.querySelector("#summary-badges"),
  iupacName: document.querySelector("#iupac-name"),
  molecularWeight: document.querySelector("#molecular-weight"),
  formulaMass: document.querySelector("#formula-mass"),
  compoundComplexity: document.querySelector("#compound-complexity"),
  structureImage: document.querySelector("#structure-image"),
  smilesText: document.querySelector("#smiles-text"),
  connectivitySmilesText: document.querySelector("#connectivity-smiles-text"),
  compositionBody: document.querySelector("#composition-body"),
  insightGrid: document.querySelector("#insight-grid"),
  synonymList: document.querySelector("#synonym-list"),
  candidateList: document.querySelector("#candidate-list"),
  sourceList: document.querySelector("#source-list"),
  viewer3d: document.querySelector("#viewer3d"),
  resetViewer: document.querySelector("#reset-viewer"),
  toggleSurface: document.querySelector("#toggle-surface"),
  balanceForm: document.querySelector("#balance-form"),
  balanceInput: document.querySelector("#balance-input"),
  balanceOutput: document.querySelector("#balance-output"),
  exampleCount: document.querySelector("#example-count"),
  periodicButton: document.querySelector("#periodic-button"),
  periodicDialog: document.querySelector("#periodic-dialog"),
  elementSearch: document.querySelector("#element-search"),
  periodicGrid: document.querySelector("#periodic-grid"),
  periodicDetail: document.querySelector("#periodic-detail"),
  periodicMatrixBody: document.querySelector("#periodic-matrix-body"),
  periodicGridView: document.querySelector("#periodic-grid-view"),
  periodicMatrixView: document.querySelector("#periodic-matrix-view"),
  gridViewButton: document.querySelector("#grid-view-button"),
  matrixViewButton: document.querySelector("#matrix-view-button"),
  elementSpotlight: document.querySelector("#element-spotlight"),
  atomDialog: document.querySelector("#atom-dialog"),
  atomTitle: document.querySelector("#atom-title"),
  atomViewer: document.querySelector("#atom-viewer"),
  atomShells: document.querySelector("#atom-shells"),
  atomProtons: document.querySelector("#atom-protons"),
  atomMass: document.querySelector("#atom-mass"),
  atomNote: document.querySelector("#atom-note"),
  mobileDockButtons: Array.from(document.querySelectorAll("[data-mobile-view]")),
};

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  bootstrap().catch((error) => {
    setStatus(error.message || "Failed to load the Molecule Builder app.", "error");
  });
});

function bindEvents() {
  refs.compoundSearchForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await searchCompound(refs.compoundQuery.value.trim());
  });

  refs.useFormulaButton.addEventListener("click", async () => {
    await searchCompound(refs.compoundQuery.value.trim());
  });

  refs.resetViewer.addEventListener("click", () => {
    if (state.viewer) {
      state.viewer.zoomTo();
      state.viewer.render();
    }
  });

  refs.toggleSurface.addEventListener("click", async () => {
    state.surfaceVisible = !state.surfaceVisible;
    refs.toggleSurface.textContent = state.surfaceVisible ? "Hide Surface" : "Toggle Surface";
    if (state.currentSdf) {
      render3DModel(state.currentSdf);
    }
  });

  refs.balanceForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const equation = refs.balanceInput.value.trim();
    if (!equation) {
      refs.balanceOutput.textContent = "Enter an equation first.";
      return;
    }
    try {
      const payload = await api(`/api/balance?equation=${encodeURIComponent(equation)}`);
      refs.balanceOutput.textContent = payload.balancedEquation;
    } catch (error) {
      refs.balanceOutput.textContent = error.message || "Could not balance that reaction.";
    }
  });

  refs.periodicButton.addEventListener("click", () => {
    openPeriodicDialog();
  });

  refs.elementSearch.addEventListener("input", () => {
    renderPeriodicGrid();
    renderPeriodicMatrix();
  });

  refs.gridViewButton.addEventListener("click", () => setPeriodicView("grid"));
  refs.matrixViewButton.addEventListener("click", () => setPeriodicView("matrix"));

  refs.mobileDockButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setMobileView(button.dataset.mobileView || "search");
    });
  });

  refs.periodicGrid.addEventListener("click", (event) => {
    const tile = event.target.closest(".periodic-tile");
    if (!tile) {
      return;
    }
    const symbol = tile.dataset.symbol;
    const element = state.elementsBySymbol.get(symbol);
    if (element) {
      selectElement(element, { openGrid: true });
    }
  });

  refs.periodicMatrixBody.addEventListener("click", (event) => {
    const row = event.target.closest("tr[data-symbol]");
    if (!row) {
      return;
    }
    const element = state.elementsBySymbol.get(row.dataset.symbol);
    if (element) {
      selectElement(element, { openGrid: true });
    }
  });

  refs.atomDialog.addEventListener("close", stopAtomAnimation);
  refs.periodicDialog.addEventListener("close", () => {
    refs.elementSearch.value = "";
    renderPeriodicGrid();
    renderPeriodicMatrix();
  });

  window.addEventListener("resize", () => {
    applyMobileLayout();
    if (state.viewer) {
      state.viewer.resize();
      state.viewer.render();
    }
  });
}

async function bootstrap() {
  const payload = await api("/api/bootstrap");
  state.elements = payload.elements || [];
  state.library = payload.library || [];
  state.sources = payload.sources || {};

  state.elements.forEach((element) => {
    state.elementsBySymbol.set(element.symbol, element);
  });

  refs.elementCount.textContent = String(state.elements.length);
  refs.libraryCount.textContent = String(state.library.length);
  refs.exampleCount.textContent = `${state.library.length} ready-to-load compounds`;

  applyMobileLayout();

  renderExampleChips();
  renderSources();
  renderPeriodicGrid();
  renderPeriodicMatrix();

  const starterElement = state.elementsBySymbol.get("H") || state.elements[0];
  if (starterElement) {
    selectElement(starterElement);
  }

  const starterCompound = state.library.find((item) => item.name.toLowerCase() === "glucose") || state.library[0];
  if (starterCompound) {
    refs.compoundQuery.value = starterCompound.name;
    await searchCompound(starterCompound.name, { activateMobileView: false });
  } else {
    setStatus("The chemistry workbench is ready.", "ok");
  }
}

async function api(url) {
  if (isBundledMode()) {
    return offlineApi(url);
  }

  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok || payload.status === "error") {
    throw new Error(payload.message || "The request failed.");
  }
  return payload;
}

function isBundledMode() {
  return BUNDLED_HOSTS.has(window.location.host) || window.location.protocol === "file:";
}

async function fetchJsonResource(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}.`);
  }
  return response.json();
}

async function loadBundledData() {
  if (state.offlineBootstrap && state.offlineCompounds.length) {
    return;
  }

  const [bootstrapPayload, offlinePayload] = await Promise.all([
    fetchJsonResource(OFFLINE_BOOTSTRAP_PATH),
    fetchJsonResource(OFFLINE_COMPOUNDS_PATH),
  ]);

  state.offlineBootstrap = bootstrapPayload;
  state.offlineCompounds = offlinePayload.compounds || [];
  state.offlineCompoundsByCid = new Map();
  state.offlineQueryIndex = new Map();

  state.offlineCompounds.forEach((compound) => {
    state.offlineCompoundsByCid.set(Number(compound.cid), compound);

    const queries = new Set([
      compound.displayName,
      compound.iupacName,
      compound.formula,
      ...(compound.synonyms || []),
      ...(compound.offlineQueries || []),
    ]);

    queries.forEach((value) => addOfflineQuery(value, Number(compound.cid)));
  });
}

function addOfflineQuery(value, cid) {
  const normalized = normalizeQuery(value);
  if (!normalized) {
    return;
  }
  const matches = state.offlineQueryIndex.get(normalized) || [];
  if (!matches.includes(cid)) {
    matches.push(cid);
    state.offlineQueryIndex.set(normalized, matches);
  }
}

function normalizeQuery(value) {
  return String(value || "").trim().toLowerCase();
}

async function offlineApi(url) {
  await loadBundledData();

  const requestUrl = new URL(url, window.location.href);
  const path = requestUrl.pathname;

  if (path === "/api/bootstrap") {
    return {
      status: "ok",
      ...(state.offlineBootstrap || { elements: [], library: [], sources: {} }),
    };
  }

  if (path === "/api/compound") {
    return resolveOfflineCompound(requestUrl.searchParams.get("query") || "");
  }

  if (path.startsWith("/api/compound/cid/") && !path.endsWith("/png") && !path.endsWith("/sdf")) {
    const cid = Number(path.split("/").pop());
    return compoundByCid(cid, `Loaded bundled candidate CID ${cid}.`);
  }

  if (path === "/api/balance") {
    const equation = requestUrl.searchParams.get("equation") || "";
    return {
      status: "ok",
      ...balanceEquationOffline(equation),
    };
  }

  throw new Error(`Unsupported bundled API path: ${path}`);
}

function resolveOfflineCompound(query) {
  const normalized = normalizeQuery(query);
  if (!normalized) {
    return { status: "error", message: "Enter a compound name or chemical formula." };
  }

  const candidateIds = state.offlineQueryIndex.get(normalized) || [];
  if (!candidateIds.length) {
    return {
      status: "not_found",
      message:
        "This standalone APK includes a bundled chemistry library for offline use. That query is not in the downloaded set yet.",
      promptForFormula: true,
      query,
    };
  }

  const candidates = buildOfflineCandidates(candidateIds);
  const formulaMode = looksLikeFormulaOffline(query);
  const payload = compoundByCid(candidateIds[0]);
  if (!formulaMode && String(query || "").trim()) {
    payload.displayName = prettifySearchLabel(query);
  }
  payload.candidates = candidates;
  payload.ambiguous = formulaMode && candidateIds.length > 1;
  payload.status = "ok";

  if (payload.ambiguous) {
    payload.message =
      "This formula maps to multiple bundled compounds or isomers. The first match is shown below, and you can load another candidate.";
  } else if (candidateIds.length > 1) {
    payload.message = "Multiple bundled matches were found. The best-ranked result is shown first.";
  } else {
    payload.message = "Compound loaded from the bundled library.";
  }

  return payload;
}

function buildOfflineCandidates(candidateIds) {
  return candidateIds
    .map((cid) => state.offlineCompoundsByCid.get(Number(cid)))
    .filter(Boolean)
    .map((compound) => ({
      cid: compound.cid,
      formula: compound.formula,
      molecularWeight: compound.molecularWeight,
      label: preferredOfflineLabel(compound),
    }));
}

function compoundByCid(cid, message) {
  const compound = state.offlineCompoundsByCid.get(Number(cid));
  if (!compound) {
    throw new Error(`Bundled compound CID ${cid} was not found.`);
  }
  const payload = JSON.parse(JSON.stringify(compound));
  payload.displayName = preferredOfflineLabel(payload);
  payload.status = "ok";
  payload.message = message || "Compound loaded from the bundled library.";
  return payload;
}

function looksLikeFormulaOffline(query) {
  const cleaned = String(query || "").trim().replace(/·/g, ".");
  return Boolean(cleaned) && OFFLINE_FORMULA_PATTERN.test(cleaned) && /[A-Z0-9]/.test(cleaned[0]);
}

function preferredOfflineLabel(compound) {
  const queryLabel = (compound.offlineQueries || []).find(
    (value) => value && !looksLikeFormulaOffline(value) && value.length <= 48
  );
  return queryLabel || compound.displayName || compound.iupacName || compound.formula || `CID ${compound.cid}`;
}

function prettifySearchLabel(query) {
  const trimmed = String(query || "").trim();
  if (!trimmed) {
    return "Unknown compound";
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function setStatus(message, kind = "ok") {
  refs.statusBanner.textContent = message;
  refs.statusBanner.className = "status-banner";
  if (kind && kind !== "ok") {
    refs.statusBanner.classList.add(kind);
  }
}

function renderExampleChips() {
  refs.exampleChips.replaceChildren();
  const fragment = document.createDocumentFragment();
  state.library.slice(0, 28).forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip";
    button.textContent = `${item.name} (${item.formula})`;
    button.addEventListener("click", async () => {
      refs.compoundQuery.value = item.name;
      await searchCompound(item.name);
    });
    fragment.appendChild(button);
  });
  refs.exampleChips.appendChild(fragment);
}

function renderSources() {
  refs.sourceList.replaceChildren();
  Object.entries(state.sources || {}).forEach(([key, value]) => {
    const link = document.createElement("a");
    link.className = "source-link";
    link.href = value;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = key;
    refs.sourceList.appendChild(link);
  });
}

async function searchCompound(query, options = {}) {
  if (!query) {
    setStatus("Enter a compound name or formula first.", "warn");
    return;
  }

  setStatus(`Searching for "${query}"...`);
  try {
    const payload = await api(`/api/compound?query=${encodeURIComponent(query)}`);
    if (payload.status === "not_found") {
      setStatus(payload.message || "The compound was not found in the current library.", "warn");
      refs.compoundMessage.textContent = payload.message || "Compound not found.";
      return;
    }
    state.currentCompound = payload;
    renderCompound(payload);
    if (options.activateMobileView !== false && isMobileLayout()) {
      setMobileView("molecule", { scroll: true });
    }
    setStatus(payload.message || "Compound loaded successfully.");
  } catch (error) {
    setStatus(error.message || "The compound lookup failed.", "error");
  }
}

function renderCompound(compound) {
  refs.compoundName.textContent = compound.displayName || "Unknown compound";
  refs.compoundFormula.textContent = compound.formula || "-";
  refs.compoundMessage.textContent = compound.message || "Compound loaded.";
  refs.iupacName.textContent = compound.iupacName || "Unavailable";
  refs.molecularWeight.textContent = compound.molecularWeight || "Unavailable";
  refs.formulaMass.textContent = compound.formulaMolarMass || "Unavailable";
  refs.compoundComplexity.textContent = compound.complexity || "Unavailable";
  refs.structureImage.src = compound.structure?.imageUrl || "";
  refs.structureImage.alt = compound.displayName ? `${compound.displayName} structure` : "2D structure";
  refs.smilesText.textContent = compound.smiles || "Unavailable";
  refs.connectivitySmilesText.textContent = compound.connectivitySmiles || "Unavailable";

  renderSummaryBadges(compound);
  renderComposition(compound.formulaBreakdown || []);
  renderInsights(compound);
  renderSynonyms(compound.synonyms || []);
  renderCandidates(compound.candidates || []);

  state.highlightedSymbols = new Set((compound.formulaBreakdown || []).map((row) => row.symbol));
  renderPeriodicGrid();
  renderPeriodicMatrix();

  const focusSymbol = topBreakdownSymbol(compound.formulaBreakdown || []);
  if (focusSymbol && state.elementsBySymbol.has(focusSymbol)) {
    selectElement(state.elementsBySymbol.get(focusSymbol));
  } else {
    renderElementSpotlight();
  }

  load3DModel(compound.structure?.sdfUrl).catch((error) => {
    refs.viewer3d.textContent = error.message || "Unable to load 3D structure.";
  });
}

function renderSummaryBadges(compound) {
  refs.summaryBadges.replaceChildren();
  const badges = [
    ["CID", compound.cid],
    ["Charge", compound.charge],
    ["Exact mass", compound.exactMass],
    ["TPSA", compound.tpsa],
    ["XLogP", compound.xlogp],
  ];
  badges.forEach(([label, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = `${label}: ${value}`;
    refs.summaryBadges.appendChild(badge);
  });
}

function renderComposition(rows) {
  refs.compositionBody.replaceChildren();
  const fragment = document.createDocumentFragment();
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.dataset.symbol = row.symbol;
    tr.innerHTML = `
      <td><button type="button" class="ghost-button">${row.symbol} - ${row.name}</button></td>
      <td>${row.count}</td>
      <td>${formatValue(row.atomicMass)}</td>
      <td>${formatValue(row.percentByMass)}%</td>
    `;
    tr.querySelector("button").addEventListener("click", () => {
      const element = state.elementsBySymbol.get(row.symbol);
      if (element) {
        openPeriodicDialog();
        selectElement(element, { openGrid: true });
      }
    });
    fragment.appendChild(tr);
  });
  refs.compositionBody.appendChild(fragment);
}

function renderInsights(compound) {
  refs.insightGrid.replaceChildren();
  const geometry = compound.analysis?.geometry || {};
  const polarity = compound.analysis?.polarity || {};
  const cards = [
    ["Geometry", geometry.shape || "Unavailable", geometry.planarity || "No geometry note"],
    ["Rotor class", geometry.rotorClass || "Unavailable", `Principal moments: ${(geometry.principalMoments || []).join(", ") || "n/a"}`],
    ["Polarity", polarity.label || "Unavailable", polarity.note || ""],
    ["Atoms / Bonds", `${compound.analysis?.atomCount || "?"} / ${compound.analysis?.bondCount || "?"}`, "Derived from the fetched 3D conformer."],
    ["H-bond donors / acceptors", `${compound.hBondDonorCount || 0} / ${compound.hBondAcceptorCount || 0}`, "PubChem property summary."],
    ["Monoisotopic mass", compound.monoisotopicMass || "Unavailable", "Useful for mass-spectrometry context."],
  ];

  const fragment = document.createDocumentFragment();
  cards.forEach(([label, value, note]) => {
    fragment.appendChild(createInfoTile(label, value, note));
  });
  refs.insightGrid.appendChild(fragment);
}

function renderSynonyms(synonyms) {
  refs.synonymList.replaceChildren();
  if (!synonyms.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No synonyms were returned.";
    refs.synonymList.appendChild(empty);
    return;
  }
  synonyms.slice(0, 12).forEach((item) => {
    const chip = document.createElement("span");
    chip.className = "synonym";
    chip.textContent = item;
    refs.synonymList.appendChild(chip);
  });
}

function renderCandidates(candidates) {
  refs.candidateList.replaceChildren();
  if (!candidates.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Alternate matches will appear here when a query is ambiguous.";
    refs.candidateList.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  candidates.forEach((candidate) => {
    const card = document.createElement("div");
    card.className = "candidate-card";
    card.innerHTML = `
      <strong>${candidate.label || `CID ${candidate.cid}`}</strong>
      <span>${candidate.formula || "Formula unavailable"}</span>
      <span>Molecular weight: ${candidate.molecularWeight || "n/a"}</span>
    `;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghost-button";
    button.textContent = "Load this match";
    button.addEventListener("click", async () => {
      const payload = await api(`/api/compound/cid/${candidate.cid}`);
      payload.message = `Loaded alternate candidate CID ${candidate.cid}.`;
      state.currentCompound = payload;
      renderCompound(payload);
      setStatus(payload.message);
    });
    card.appendChild(button);
    fragment.appendChild(card);
  });
  refs.candidateList.appendChild(fragment);
}

async function load3DModel(sdfUrl) {
  if (!sdfUrl || !window.$3Dmol) {
    refs.viewer3d.textContent = "3D viewer unavailable.";
    return;
  }

  const response = await fetch(sdfUrl);
  state.currentSdf = await response.text();
  render3DModel(state.currentSdf);
}

function render3DModel(sdfText) {
  refs.viewer3d.textContent = "";
  if (!state.viewer) {
    state.viewer = $3Dmol.createViewer(refs.viewer3d, { backgroundColor: "#081523" });
  }

  state.viewer.clear();
  state.viewer.addModel(sdfText, "sdf");
  state.viewer.setStyle({}, { stick: { radius: 0.18 }, sphere: { scale: 0.3 } });
  if (state.surfaceVisible) {
    state.viewer.addSurface($3Dmol.VDW, { opacity: 0.16, color: "white" });
  }
  state.viewer.zoomTo();
  state.viewer.render();
}

function openPeriodicDialog() {
  if (!refs.periodicDialog.open) {
    refs.periodicDialog.showModal();
  }
  setPeriodicView(isMobileLayout() ? "grid" : "matrix");
}

function setPeriodicView(mode) {
  state.periodicView = mode;
  refs.gridViewButton.classList.toggle("active", mode === "grid");
  refs.matrixViewButton.classList.toggle("active", mode === "matrix");
  refs.periodicGridView.classList.toggle("hidden", mode !== "grid");
  refs.periodicMatrixView.classList.toggle("hidden", mode !== "matrix");
}

function isMobileLayout() {
  return window.matchMedia("(max-width: 900px)").matches;
}

function setMobileView(view, options = {}) {
  state.mobileView = view;
  applyMobileLayout();
  if (options.scroll && isMobileLayout()) {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function applyMobileLayout() {
  const mobile = isMobileLayout();
  document.body.classList.toggle("mobile-layout", mobile);
  document.body.dataset.mobileView = state.mobileView || "search";
  refs.mobileDockButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mobileView === state.mobileView);
  });
  if (mobile && refs.periodicDialog.open) {
    setPeriodicView("grid");
  }
}

function renderPeriodicGrid() {
  refs.periodicGrid.replaceChildren();
  const query = refs.elementSearch.value.trim().toLowerCase();
  const mobileLayout = isMobileLayout();
  const fragment = document.createDocumentFragment();
  refs.periodicGrid.classList.toggle("mobile-periodic-grid", mobileLayout);

  state.elements.forEach((element) => {
    const profile = element.profile || {};
    const tile = document.createElement("button");
    tile.type = "button";
    tile.dataset.symbol = element.symbol;
    tile.className = `periodic-tile category-${slugify(element.category || "unknown")}`;
    if (mobileLayout) {
      tile.style.removeProperty("grid-column");
      tile.style.removeProperty("grid-row");
    } else {
      tile.style.gridColumn = String(profile.group || 1);
      tile.style.gridRow = String(profile.period || 1);
    }
    tile.innerHTML = `
      <span class="atomic-number">${element.atomicNumber}</span>
      <span class="symbol">${element.symbol}</span>
      <span class="name">${element.name}</span>
      <span class="mobile-meta">${formatValue(element.atomicMass)} u</span>
      <span class="mobile-category">${element.category || "Unknown"}</span>
    `;

    if (matchesElementFilter(element, query) === false) {
      tile.classList.add("hidden");
    }
    if (state.highlightedSymbols.has(element.symbol)) {
      tile.classList.add("match-highlight");
    }
    if (state.currentElement?.symbol === element.symbol) {
      tile.classList.add("active");
    }
    fragment.appendChild(tile);
  });

  refs.periodicGrid.appendChild(fragment);
}

function renderPeriodicMatrix() {
  const query = refs.elementSearch.value.trim().toLowerCase();
  refs.periodicMatrixBody.innerHTML = state.elements
    .filter((element) => matchesElementFilter(element, query))
    .map((element) => {
      const profile = element.profile || {};
      const history = profile.history || {};
      return `
        <tr data-symbol="${element.symbol}">
          <td>${element.atomicNumber}</td>
          <td>${element.symbol}</td>
          <td>${element.name}</td>
          <td>${formatValue(element.atomicMass)}</td>
          <td>${(element.oxidationStates || []).join(", ") || "-"}</td>
          <td>${(element.commonValencies || []).join(", ") || "-"}</td>
          <td>${element.electronConfiguration || "-"}</td>
          <td>${formatValue(element.electronegativity)}</td>
          <td>${formatValue(element.atomicRadiusPm)}</td>
          <td>${formatValue(element.ionizationEnergyEv)}</td>
          <td>${formatValue(element.electronAffinityEv)}</td>
          <td>${element.standardState || "-"}</td>
          <td>${formatValue(element.meltingPointK)}</td>
          <td>${formatValue(element.boilingPointK)}</td>
          <td>${formatValue(element.densityGPerCm3)}</td>
          <td>${element.category || "-"}</td>
          <td>${element.yearDiscovered || "-"}</td>
          <td>${history.note || "-"}</td>
          <td>${profile.geography?.note || "-"}</td>
          <td>${profile.civics?.note || "-"}</td>
        </tr>
      `;
    })
    .join("");
}

function selectElement(element, options = {}) {
  state.currentElement = element;
  renderElementDetail(element);
  renderElementSpotlight();
  renderPeriodicGrid();
  if (options.openGrid) {
    setPeriodicView("grid");
  }
}

function renderElementDetail(element) {
  const profile = element.profile || {};
  const history = profile.history || {};
  refs.periodicDetail.innerHTML = `
    <div class="detail-head">
      <div>
        <p class="panel-kicker">Element Detail</p>
        <h3>${element.name} (${element.symbol})</h3>
      </div>
      <button id="visualize-atom-button" class="primary-button" type="button">Visualize Atom</button>
    </div>
    <div class="detail-grid">
      ${detailRow("Atomic number", element.atomicNumber)}
      ${detailRow("Atomic mass", formatValue(element.atomicMass))}
      ${detailRow("Category", element.category || "-")}
      ${detailRow("Standard state", element.standardState || "-")}
      ${detailRow("Group / Period", `${profile.group || "-"} / ${profile.period || "-"}`)}
      ${detailRow("Electron config", element.electronConfiguration || "-")}
      ${detailRow("Oxidation states", (element.oxidationStates || []).join(", ") || "-")}
      ${detailRow("Valencies", (element.commonValencies || []).join(", ") || "-")}
      ${detailRow("Electronegativity", formatValue(element.electronegativity))}
      ${detailRow("Atomic radius", formatValue(element.atomicRadiusPm) + " pm")}
      ${detailRow("Ionization energy", formatValue(element.ionizationEnergyEv) + " eV")}
      ${detailRow("Electron affinity", formatValue(element.electronAffinityEv) + " eV")}
      ${detailRow("Melting / boiling", `${formatValue(element.meltingPointK)} K / ${formatValue(element.boilingPointK)} K`)}
      ${detailRow("Density", `${formatValue(element.densityGPerCm3)} g/cm3`)}
      ${detailRow("Discovered", history.yearDiscovered || element.yearDiscovered || "-")}
      ${detailRow("Discovered by", history.discoveredBy || "-")}
      ${detailRow("Named by", history.namedBy || "-")}
    </div>
    <section class="detail-section">
      <h4>History</h4>
      <p>${history.note || "Historical context unavailable."}</p>
    </section>
    <section class="detail-section">
      <h4>Geography</h4>
      <p>${profile.geography?.note || "Geographic and occurrence context unavailable."}</p>
    </section>
    <section class="detail-section">
      <h4>Civics</h4>
      <p>${profile.civics?.note || "Civic and societal relevance unavailable."}</p>
    </section>
    <section class="detail-section">
      <h4>Reference Summary</h4>
      <p>${profile.summary || "A summary for this element is unavailable in the local profile."}</p>
      ${profile.referenceUrl ? `<p><a class="source-link" href="${profile.referenceUrl}" target="_blank" rel="noreferrer">Open reference</a></p>` : ""}
    </section>
  `;

  refs.periodicDetail.querySelector("#visualize-atom-button").addEventListener("click", () => {
    openAtomVisualizer(element);
  });
}

function renderElementSpotlight() {
  if (!state.currentElement) {
    refs.elementSpotlight.innerHTML = '<p class="empty-state">Select an element to inspect it here.</p>';
    return;
  }

  const compositionRows = state.currentCompound?.formulaBreakdown || [];
  const chips = compositionRows
    .map(
      (row) =>
        `<button type="button" class="chip spotlight-chip" data-symbol="${row.symbol}">${row.symbol} (${row.count})</button>`
    )
    .join("");

  refs.elementSpotlight.innerHTML = `
    <div class="detail-head">
      <div>
        <h3>${state.currentElement.name}</h3>
        <p class="panel-kicker">${state.currentElement.symbol} | ${state.currentElement.category || "element"}</p>
      </div>
      <button id="spotlight-visualize" class="ghost-button" type="button">Visualize Atom</button>
    </div>
    <p class="body-copy">${state.currentElement.profile?.summary || "Select a compound or periodic-table tile for richer notes."}</p>
    <div class="chip-grid">${chips || '<span class="synonym">No active compound composition</span>'}</div>
  `;

  refs.elementSpotlight.querySelector("#spotlight-visualize").addEventListener("click", () => {
    openAtomVisualizer(state.currentElement);
  });

  refs.elementSpotlight.querySelectorAll("[data-symbol]").forEach((button) => {
    button.addEventListener("click", () => {
      const element = state.elementsBySymbol.get(button.dataset.symbol);
      if (element) {
        openPeriodicDialog();
        selectElement(element, { openGrid: true });
      }
    });
  });
}

function openAtomVisualizer(element) {
  refs.atomTitle.textContent = `${element.name} (${element.symbol})`;
  refs.atomShells.textContent = (element.profile?.electronShells || []).join(", ") || "Unavailable";
  refs.atomProtons.textContent = String(element.atomicNumber);
  refs.atomMass.textContent = formatValue(element.atomicMass);
  refs.atomNote.textContent = `Animated Bohr-style model for ${element.name}. Electron configuration: ${element.electronConfiguration || "unavailable"}.`;

  if (!refs.atomDialog.open) {
    refs.atomDialog.showModal();
  }
  startAtomAnimation(element);
}

function startAtomAnimation(element) {
  stopAtomAnimation();
  state.atomCanvas = document.createElement("canvas");
  refs.atomViewer.replaceChildren(state.atomCanvas);
  const context = state.atomCanvas.getContext("2d");
  const shells = element.profile?.electronShells || [];
  const protonCount = element.atomicNumber;
  const neutronCount = Math.max(0, Math.round(Number(element.atomicMass) || protonCount) - protonCount);

  const render = (timestamp) => {
    const width = refs.atomViewer.clientWidth || 620;
    const height = refs.atomViewer.clientHeight || 430;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    state.atomCanvas.width = Math.round(width * ratio);
    state.atomCanvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const centerX = width / 2;
    const centerY = height / 2;
    const baseRadius = Math.min(width, height) * 0.12;

    context.fillStyle = "rgba(255,255,255,0.02)";
    context.fillRect(0, 0, width, height);

    shells.forEach((count, shellIndex) => {
      const radius = baseRadius + 36 + shellIndex * 34;
      context.beginPath();
      context.arc(centerX, centerY, radius, 0, Math.PI * 2);
      context.strokeStyle = "rgba(122, 214, 255, 0.22)";
      context.lineWidth = 1.3;
      context.stroke();

      for (let electronIndex = 0; electronIndex < count; electronIndex += 1) {
        const angle = timestamp * 0.00042 * (shellIndex + 1) + ((Math.PI * 2) / count) * electronIndex;
        const x = centerX + Math.cos(angle) * radius;
        const y = centerY + Math.sin(angle) * radius;
        context.beginPath();
        context.arc(x, y, 4.3, 0, Math.PI * 2);
        context.fillStyle = "#52f0ff";
        context.shadowColor = "rgba(82, 240, 255, 0.65)";
        context.shadowBlur = 12;
        context.fill();
        context.shadowBlur = 0;
      }
    });

    context.beginPath();
    context.arc(centerX, centerY, baseRadius, 0, Math.PI * 2);
    context.fillStyle = "rgba(33, 115, 179, 0.95)";
    context.fill();
    context.lineWidth = 2;
    context.strokeStyle = "rgba(162, 227, 255, 0.8)";
    context.stroke();

    context.fillStyle = "#f5fbff";
    context.font = '700 22px "Space Grotesk"';
    context.textAlign = "center";
    context.fillText(element.symbol, centerX, centerY - 4);
    context.font = '500 11px "IBM Plex Mono"';
    context.fillStyle = "#cdeefe";
    context.fillText(`${protonCount} p / ${neutronCount} n`, centerX, centerY + 16);

    state.atomFrameId = requestAnimationFrame(render);
  };

  state.atomFrameId = requestAnimationFrame(render);
}

function stopAtomAnimation() {
  if (state.atomFrameId) {
    cancelAnimationFrame(state.atomFrameId);
    state.atomFrameId = null;
  }
}

function matchesElementFilter(element, query) {
  if (!query) {
    return true;
  }
  return [
    element.name,
    element.symbol,
    String(element.atomicNumber),
    element.category,
    element.groupBlock,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query));
}

function topBreakdownSymbol(rows) {
  if (!rows.length) {
    return null;
  }
  return rows.slice().sort((a, b) => b.percentByMass - a.percentByMass)[0].symbol;
}

function detailRow(label, value) {
  return `<div class="detail-row"><span>${label}</span><strong>${value}</strong></div>`;
}

function createInfoTile(label, value, note) {
  const tile = document.createElement("div");
  tile.className = "info-tile";
  tile.innerHTML = `
    <span class="tile-label">${label}</span>
    <strong>${value}</strong>
    <span class="body-copy">${note || ""}</span>
  `;
  return tile;
}

function balanceEquationOffline(equation) {
  const [reactants, products] = parseEquationOffline(equation);
  const compounds = reactants.concat(products);
  const compositions = [];
  const elementSet = new Set();

  compounds.forEach((token) => {
    const [, formula] = normalizeCompoundTokenOffline(token);
    const counts = parseFormulaOffline(formula);
    compositions.push(counts);
    Object.keys(counts).forEach((symbol) => elementSet.add(symbol));
  });

  const orderedElements = Array.from(elementSet).sort();
  const matrix = orderedElements.map((symbol) =>
    compositions.map((counts, index) =>
      fraction(BigInt(index < reactants.length ? counts[symbol] || 0 : -(counts[symbol] || 0)), 1n)
    )
  );

  const solution = solveNullspaceOffline(matrix);
  const denominatorLcm = solution.reduce((current, value) => bigintLcm(current, value.d), 1n);
  let coefficients = solution.map((value) => (value.n * (denominatorLcm / value.d)));

  const firstNonZero = coefficients.find((value) => value !== 0n) || 1n;
  if (firstNonZero < 0n) {
    coefficients = coefficients.map((value) => -value);
  }

  const gcd = coefficients.reduce((current, value) => {
    const absolute = bigintAbs(value);
    if (absolute === 0n) {
      return current;
    }
    return current === 0n ? absolute : bigintGcd(current, absolute);
  }, 0n) || 1n;

  coefficients = coefficients.map((value) => value / gcd);

  const leftParts = reactants.map((token, index) => formatBalancedToken(coefficients[index], token));
  const rightParts = products.map((token, index) =>
    formatBalancedToken(coefficients[index + reactants.length], token)
  );

  return {
    balancedEquation: `${leftParts.join(" + ")} -> ${rightParts.join(" + ")}`,
    coefficients: coefficients.map((value) => value.toString()),
    elements: orderedElements,
  };
}

function parseEquationOffline(equation) {
  const normalized = String(equation || "")
    .replace(/<->/g, "->")
    .replace(/\u21cc/g, "->")
    .replace(/=/g, "->");

  if (!normalized.includes("->")) {
    throw new Error("Use '->' or '=' to separate reactants and products.");
  }

  const [reactantsText, productsText] = normalized.split("->", 2);
  const reactants = reactantsText.split("+").map((token) => token.trim()).filter(Boolean);
  const products = productsText.split("+").map((token) => token.trim()).filter(Boolean);

  if (!reactants.length || !products.length) {
    throw new Error("Both reactants and products are required.");
  }

  return [reactants, products];
}

function formatBalancedToken(coefficient, token) {
  const [, cleaned] = normalizeCompoundTokenOffline(token);
  return coefficient === 1n ? cleaned : `${coefficient.toString()} ${cleaned}`;
}

function normalizeCompoundTokenOffline(token) {
  const stripped = stripPhaseSuffixOffline(String(token || "").trim());
  if (!stripped) {
    throw new Error("Empty compound token.");
  }

  const match = stripped.match(/^(\d+)\s*([A-Za-z(].*)$/);
  if (match) {
    return [Number(match[1]), match[2].trim()];
  }
  return [1, stripped];
}

function stripPhaseSuffixOffline(formula) {
  return String(formula || "").trim().replace(/\((aq|s|l|g)\)$/i, "");
}

function parseFormulaOffline(formula) {
  const cleaned = stripPhaseSuffixOffline(formula).replace(/\s+/g, "").replace(/·/g, ".");
  if (!cleaned) {
    throw new Error("Empty formula.");
  }

  const total = {};
  cleaned.split(".").forEach((part) => {
    if (!part) {
      return;
    }
    const [multiplier, core] = splitLeadingMultiplierOffline(part);
    const [counts, index] = parseGroupOffline(core, 0);
    if (index !== core.length) {
      throw new Error(`Could not fully parse formula near '${core.slice(index)}'.`);
    }
    Object.entries(counts).forEach(([symbol, amount]) => {
      total[symbol] = (total[symbol] || 0) + amount * multiplier;
    });
  });

  if (!Object.keys(total).length) {
    throw new Error("No atoms were found in the formula.");
  }

  return total;
}

function splitLeadingMultiplierOffline(text) {
  const match = String(text || "").match(/^(\d+)(.*)$/);
  if (!match) {
    return [1, text];
  }
  return [Number(match[1]), match[2]];
}

function parseGroupOffline(text, startIndex) {
  const counts = {};
  let index = startIndex;

  while (index < text.length) {
    const character = text[index];
    if ("([{".includes(character)) {
      const [nested, nestedIndex] = parseGroupOffline(text, index + 1);
      index = nestedIndex;
      if (index >= text.length || !")]}".includes(text[index])) {
        throw new Error("Unmatched parenthesis in formula.");
      }
      index += 1;
      const [multiplier, nextIndex] = parseNumberOffline(text, index);
      index = nextIndex;
      Object.entries(nested).forEach(([symbol, amount]) => {
        counts[symbol] = (counts[symbol] || 0) + amount * multiplier;
      });
      continue;
    }

    if (")]}".includes(character)) {
      return [counts, index];
    }

    if (/[A-Z]/.test(character)) {
      const match = text.slice(index).match(/^[A-Z][a-z]?/);
      if (!match) {
        throw new Error(`Invalid element token near '${text.slice(index)}'.`);
      }
      const symbol = match[0];
      if (!state.elementsBySymbol.has(symbol)) {
        throw new Error(`Unknown element symbol '${symbol}'.`);
      }
      index += symbol.length;
      const [multiplier, nextIndex] = parseNumberOffline(text, index);
      index = nextIndex;
      counts[symbol] = (counts[symbol] || 0) + multiplier;
      continue;
    }

    throw new Error(`Unexpected token '${character}' in formula.`);
  }

  return [counts, index];
}

function parseNumberOffline(text, index) {
  const match = text.slice(index).match(/^\d+/);
  if (!match) {
    return [1, index];
  }
  return [Number(match[0]), index + match[0].length];
}

function solveNullspaceOffline(matrix) {
  const rows = matrix.length;
  const cols = matrix[0]?.length || 0;
  const working = matrix.map((row) => row.map((value) => fraction(value.n, value.d)));
  const pivotColumns = [];
  let rowIndex = 0;

  for (let colIndex = 0; colIndex < cols; colIndex += 1) {
    let pivot = -1;
    for (let candidate = rowIndex; candidate < rows; candidate += 1) {
      if (!isZeroFraction(working[candidate][colIndex])) {
        pivot = candidate;
        break;
      }
    }
    if (pivot === -1) {
      continue;
    }

    [working[rowIndex], working[pivot]] = [working[pivot], working[rowIndex]];
    const divisor = working[rowIndex][colIndex];
    working[rowIndex] = working[rowIndex].map((value) => divideFractions(value, divisor));

    for (let candidate = 0; candidate < rows; candidate += 1) {
      if (candidate === rowIndex) {
        continue;
      }
      const factor = working[candidate][colIndex];
      if (isZeroFraction(factor)) {
        continue;
      }
      working[candidate] = working[candidate].map((value, innerIndex) =>
        subtractFractions(value, multiplyFractions(factor, working[rowIndex][innerIndex]))
      );
    }

    pivotColumns.push(colIndex);
    rowIndex += 1;
    if (rowIndex === rows) {
      break;
    }
  }

  const freeColumns = [];
  for (let index = 0; index < cols; index += 1) {
    if (!pivotColumns.includes(index)) {
      freeColumns.push(index);
    }
  }

  if (!freeColumns.length) {
    throw new Error("Could not find a balancing solution.");
  }

  const solution = Array.from({ length: cols }, () => fraction(0n, 1n));
  freeColumns.forEach((column) => {
    solution[column] = fraction(1n, 1n);
  });

  for (let reverseIndex = pivotColumns.length - 1; reverseIndex >= 0; reverseIndex -= 1) {
    const pivotColumn = pivotColumns[reverseIndex];
    let value = fraction(0n, 1n);
    freeColumns.forEach((column) => {
      value = subtractFractions(value, multiplyFractions(working[reverseIndex][column], solution[column]));
    });
    solution[pivotColumn] = value;
  }

  return solution;
}

function fraction(numerator, denominator) {
  let numeratorValue = typeof numerator === "bigint" ? numerator : BigInt(numerator);
  let denominatorValue = typeof denominator === "bigint" ? denominator : BigInt(denominator);
  if (denominatorValue === 0n) {
    throw new Error("Division by zero in fraction arithmetic.");
  }
  if (denominatorValue < 0n) {
    numeratorValue = -numeratorValue;
    denominatorValue = -denominatorValue;
  }
  const divisor = bigintGcd(bigintAbs(numeratorValue), bigintAbs(denominatorValue)) || 1n;
  return {
    n: numeratorValue / divisor,
    d: denominatorValue / divisor,
  };
}

function addFractions(left, right) {
  return fraction(left.n * right.d + right.n * left.d, left.d * right.d);
}

function subtractFractions(left, right) {
  return fraction(left.n * right.d - right.n * left.d, left.d * right.d);
}

function multiplyFractions(left, right) {
  return fraction(left.n * right.n, left.d * right.d);
}

function divideFractions(left, right) {
  return fraction(left.n * right.d, left.d * right.n);
}

function isZeroFraction(value) {
  return value.n === 0n;
}

function bigintAbs(value) {
  return value < 0n ? -value : value;
}

function bigintGcd(left, right) {
  let a = bigintAbs(left);
  let b = bigintAbs(right);
  while (b !== 0n) {
    [a, b] = [b, a % b];
  }
  return a;
}

function bigintLcm(left, right) {
  if (left === 0n || right === 0n) {
    return 0n;
  }
  return bigintAbs((left / bigintGcd(left, right)) * right);
}

function formatValue(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  return String(value);
}

function slugify(value) {
  return String(value || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
