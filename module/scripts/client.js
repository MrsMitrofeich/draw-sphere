// draw-sphere — FoundryVTT module
// Consumes the DNDAR WebSocket protocol (dndar/1).
// Contract reference: contract/ws-protocol.ts

const PROTOCOL = "dndar/1";

// ── Runtime validator ──────────────────────────────────────────────────────

function parseMsg(raw) {
  let m;
  try { m = JSON.parse(raw); } catch { return null; }
  if (!m || m.protocol !== PROTOCOL) return null;
  if (typeof m.markerId !== "number") return null;
  if (m.type === "marker_lost") return m;
  if (m.type === "marker_update") {
    if (typeof m.x !== "number" || typeof m.y !== "number") return null;
    if (typeof m.rotation !== "number") return null;
    if (!m.template?.kind) return null;
    return m;
  }
  return null;
}

// ── Coordinate conversion ──────────────────────────────────────────────────
// iOS sends normalised [0,1] relative to TV screen = Foundry scene area.
// canvas.dimensions gives the scene rect in canvas world coordinates.

function normToScene(nx, ny) {
  const rect = canvas.app.canvas.getBoundingClientRect();
  return canvas.canvasCoordinatesFromClient({
    x: rect.left + nx * rect.width,
    y: rect.top  + ny * rect.height,
  });
}

// ── Template state ─────────────────────────────────────────────────────────

const active   = new Map(); // markerId → MeasuredTemplate doc id
const rulerPts = new Map(); // markerId → {sceneX, sceneY}
let rulerDocId = null;

// ── Document helpers (GM-only, called directly since we guard with isGM) ──

async function createTemplate(data) {
  if (!canvas?.scene) return null;
  const [doc] = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [data]);
  return doc?.id ?? null;
}

async function updateTemplate(id, data) {
  if (!canvas?.scene) return;
  const doc = canvas.scene.templates.get(id);
  if (doc) await doc.update(data);
}

async function deleteTemplate(id) {
  if (!canvas?.scene) return;
  const doc = canvas.scene.templates.get(id);
  if (doc) await canvas.scene.deleteEmbeddedDocuments("MeasuredTemplate", [doc.id]);
}

// ── Template data builders ─────────────────────────────────────────────────

function buildCreateData(template, sceneX, sceneY, rotationRad, markerId) {
  const base = {
    user: game.user.id,
    x: sceneX, y: sceneY,
    flags: { "draw-sphere": { markerId } },
  };
  const { size: gridPx, distance: gridFt } = canvas.dimensions;
  const ftToPx  = gridPx / gridFt;
  const dirDeg  = (rotationRad * 180) / Math.PI;

  switch (template.kind) {
    case "circle":
      return { ...base, t: "circle", distance: template.sizeFt, direction: 0, angle: 360, fillColor: "#FF4444" };
    case "cone":
      return { ...base, t: "cone", distance: template.sizeFt, direction: dirDeg, angle: template.angleDeg, fillColor: "#FF8800" };
    case "ray":
      return { ...base, t: "ray", distance: template.sizeFt, direction: dirDeg, width: template.widthFt, fillColor: "#00AAFF" };
    case "rect": {
      const halfPx = (template.widthFt * ftToPx) / 2;
      return { ...base, t: "rect", x: sceneX - halfPx, y: sceneY - halfPx, distance: template.sizeFt, direction: dirDeg, fillColor: "#00CC44" };
    }
    default: return null;
  }
}

function buildUpdateData(template, sceneX, sceneY, rotationRad) {
  const { size: gridPx, distance: gridFt } = canvas.dimensions;
  const ftToPx  = gridPx / gridFt;
  const dirDeg  = (rotationRad * 180) / Math.PI;

  switch (template.kind) {
    case "circle":
      return { x: sceneX, y: sceneY };
    case "cone":
    case "ray":
      return { x: sceneX, y: sceneY, direction: dirDeg };
    case "rect": {
      const halfPx = (template.widthFt * ftToPx) / 2;
      return { x: sceneX - halfPx, y: sceneY - halfPx, direction: dirDeg };
    }
    default: return null;
  }
}

// ── Ruler handling ─────────────────────────────────────────────────────────

async function handleRulerUpdate(markerId, template, sceneX, sceneY) {
  rulerPts.set(markerId, { sceneX, sceneY });

  const pairedId = template.pairedMarkerId;
  const paired   = rulerPts.get(pairedId);
  if (!paired) return; // wait for the other endpoint

  const isBegin = template.kind === "ruler_begin";
  const bx = isBegin ? sceneX : paired.sceneX;
  const by = isBegin ? sceneY : paired.sceneY;
  const ex = isBegin ? paired.sceneX : sceneX;
  const ey = isBegin ? paired.sceneY : sceneY;

  const dx = ex - bx, dy = ey - by;
  const { size: gridPx, distance: gridFt } = canvas.dimensions;
  const distFt = Math.sqrt(dx * dx + dy * dy) * (gridFt / gridPx);
  let dirDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (dirDeg < 0) dirDeg += 360;

  const data = {
    t: "ray",
    user: game.user.id,
    x: bx, y: by,
    distance: distFt,
    direction: dirDeg,
    width: 1,
    fillColor: "#FFFF00",
    flags: { "draw-sphere": { ruler: true } },
  };

  if (rulerDocId) {
    await updateTemplate(rulerDocId, { x: bx, y: by, distance: distFt, direction: dirDeg });
  } else {
    rulerDocId = await createTemplate(data);
  }
}

async function handleRulerLost(markerId) {
  rulerPts.delete(markerId);
  if (rulerDocId) {
    await deleteTemplate(rulerDocId);
    rulerDocId = null;
  }
}

// ── Message handlers ───────────────────────────────────────────────────────

async function handleUpdate(msg) {
  if (!canvas?.dimensions) return;
  const { markerId, x, y, rotation, template } = msg;
  const { x: sceneX, y: sceneY } = normToScene(x, y);

  if (template.kind === "ruler_begin" || template.kind === "ruler_end") {
    await handleRulerUpdate(markerId, template, sceneX, sceneY);
    return;
  }

  const existingId = active.get(markerId);
  if (existingId) {
    const update = buildUpdateData(template, sceneX, sceneY, rotation);
    if (update) await updateTemplate(existingId, update);
  } else {
    const createData = buildCreateData(template, sceneX, sceneY, rotation, markerId);
    if (!createData) return;
    const id = await createTemplate(createData);
    if (id) active.set(markerId, id);
  }
}

async function handleLost(msg) {
  const { markerId } = msg;
  const id = active.get(markerId);
  if (id) {
    await deleteTemplate(id);
    active.delete(markerId);
  }
  if (rulerPts.has(markerId)) {
    await handleRulerLost(markerId);
  }
}

// ── WebSocket connection ───────────────────────────────────────────────────

function connectToRelay(wsUrl) {
  const ws = new WebSocket(wsUrl);

  ws.addEventListener("open", () =>
    console.log("draw-sphere: connected to relay", wsUrl)
  );

  ws.addEventListener("message", async ({ data }) => {
    const msg = parseMsg(data);
    if (!msg) return;
    if (msg.type === "marker_update") await handleUpdate(msg);
    else if (msg.type === "marker_lost") await handleLost(msg);
  });

  ws.addEventListener("close", () => {
    console.warn("draw-sphere: relay disconnected — retry in 3s");
    active.clear();
    rulerPts.clear();
    rulerDocId = null;
    setTimeout(() => connectToRelay(wsUrl), 3000);
  });

  ws.addEventListener("error", (err) =>
    console.error("draw-sphere: WS error", err)
  );
}

// ── Foundry hook ───────────────────────────────────────────────────────────

Hooks.once("ready", () => {
  const tvUserId = game.settings.get("draw-sphere", "tvUserId");
  const isResponsible = tvUserId
    ? game.user.id === tvUserId
    : game.user.isGM;
  if (!isResponsible) return;
  const wsUrl = game.settings.get("draw-sphere", "wsUrl");
  if (!wsUrl) return;
  connectToRelay(wsUrl);
});
