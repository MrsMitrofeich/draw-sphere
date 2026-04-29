// draw-sphere — FoundryVTT module
// Consumes the DNDAR WebSocket protocol (dndar/1).
// Contract reference: contract/ws-protocol.ts

const PROTOCOL = "dndar/1";

// ── Runtime validator (mirrors parseWSMessage from contract/ws-protocol.ts) ──

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

function normToScene(x, y) {
  const screenX = x * window.innerWidth;
  const screenY = y * window.innerHeight;
  const t = canvas.stage.worldTransform;
  return {
    x: (screenX - t.tx) / t.a,
    y: (screenY - t.ty) / t.d,
  };
}

// ── Template state ─────────────────────────────────────────────────────────
// markerId → Foundry document id

const active = new Map();          // regular templates
const rulerPts = new Map();        // markerId → {x, y, sceneX, sceneY} for ruler endpoints
let rulerDocId = null;             // single ruler line (ray template)

// ── GM-side drawing functions (run via socketlib.executeAsGM) ──────────────

async function gmCreateTemplate(data) {
  if (!canvas?.scene) return null;
  const [doc] = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [data]);
  return doc?.id ?? null;
}

async function gmUpdateTemplate(id, data) {
  if (!canvas?.scene) return;
  const doc = canvas.scene.templates.get(id);
  if (doc) await doc.update(data);
}

async function gmDeleteTemplate(id) {
  if (!canvas?.scene) return;
  const doc = canvas.scene.templates.get(id);
  if (doc) await canvas.scene.deleteEmbeddedDocuments("MeasuredTemplate", [doc.id]);
}

// ── Template data builders ─────────────────────────────────────────────────

function buildCreateData(template, sceneX, sceneY, rotationRad, markerId) {
  const base = {
    user: game.user.id,
    x: sceneX,
    y: sceneY,
    flags: { "draw-sphere": { markerId } },
  };
  const scene = canvas.scene;
  const gridPx = scene.dimensions.size;
  const gridFt = scene.dimensions.distance;
  const ftToPx = gridPx / gridFt;
  const dirDeg = (rotationRad * 180) / Math.PI;

  switch (template.kind) {
    case "circle":
      return { ...base, t: "circle", distance: template.sizeFt, direction: 0, angle: 360, fillColor: "#FF4444" };

    case "cone":
      return { ...base, t: "cone", distance: template.sizeFt, direction: dirDeg, angle: template.angleDeg, fillColor: "#FF8800" };

    case "ray":
      return { ...base, t: "ray", distance: template.sizeFt, direction: dirDeg, width: template.widthFt, fillColor: "#00AAFF" };

    case "rect": {
      const halfPx = (template.widthFt * ftToPx) / 2;
      return {
        ...base,
        t: "rect",
        x: sceneX - halfPx,
        y: sceneY - halfPx,
        distance: template.sizeFt,
        direction: dirDeg,
        fillColor: "#00CC44",
      };
    }

    default:
      return null;
  }
}

function buildUpdateData(template, sceneX, sceneY, rotationRad) {
  const scene = canvas.scene;
  const gridPx = scene.dimensions.size;
  const gridFt = scene.dimensions.distance;
  const ftToPx = gridPx / gridFt;
  const dirDeg = (rotationRad * 180) / Math.PI;

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

    default:
      return null;
  }
}

// ── Ruler handling ─────────────────────────────────────────────────────────
// ruler_begin and ruler_end are two separate markers; together they define a ray.

async function handleRulerUpdate(markerId, template, sceneX, sceneY, normX, normY) {
  rulerPts.set(markerId, { sceneX, sceneY, normX, normY });

  // Find the paired endpoint
  const pairedId = template.pairedMarkerId;
  const paired = rulerPts.get(pairedId);
  if (!paired) return;   // waiting for the other marker

  // Determine which is begin/end
  const isBegin = template.kind === "ruler_begin";
  const bx = isBegin ? sceneX : paired.sceneX;
  const by = isBegin ? sceneY : paired.sceneY;
  const ex = isBegin ? paired.sceneX : sceneX;
  const ey = isBegin ? paired.sceneY : sceneY;

  const dx = ex - bx, dy = ey - by;
  const scene = canvas.scene;
  const gridPx = scene.dimensions.size;
  const gridFt = scene.dimensions.distance;
  const distPx = Math.sqrt(dx * dx + dy * dy);
  const distFt = distPx * (gridFt / gridPx);
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
    await socket.executeAsGM("gmUpdateTemplate", rulerDocId, { x: bx, y: by, distance: distFt, direction: dirDeg });
  } else {
    rulerDocId = await socket.executeAsGM("gmCreateTemplate", data);
  }
}

async function handleRulerLost(markerId) {
  rulerPts.delete(markerId);
  if (rulerDocId) {
    await socket.executeAsGM("gmDeleteTemplate", rulerDocId);
    rulerDocId = null;
  }
}

// ── Message handlers ───────────────────────────────────────────────────────

async function handleUpdate(msg) {
  const { markerId, x, y, rotation, template } = msg;
  const { x: sceneX, y: sceneY } = normToScene(x, y);

  if (template.kind === "ruler_begin" || template.kind === "ruler_end") {
    await handleRulerUpdate(markerId, template, sceneX, sceneY, x, y);
    return;
  }

  const existingId = active.get(markerId);
  if (existingId) {
    const update = buildUpdateData(template, sceneX, sceneY, rotation);
    if (update) await socket.executeAsGM("gmUpdateTemplate", existingId, update);
  } else {
    const createData = buildCreateData(template, sceneX, sceneY, rotation, markerId);
    if (!createData) return;
    const id = await socket.executeAsGM("gmCreateTemplate", createData);
    if (id) active.set(markerId, id);
  }
}

async function handleLost(msg) {
  const { markerId } = msg;
  const id = active.get(markerId);
  if (id) {
    await socket.executeAsGM("gmDeleteTemplate", id);
    active.delete(markerId);
  }
  if (rulerPts.has(markerId)) {
    await handleRulerLost(markerId);
  }
}

// ── Foundry hooks ──────────────────────────────────────────────────────────

let socket;

Hooks.once("socketlib.ready", () => {
  socket = socketlib.registerModule("draw-sphere");
  socket.register("gmCreateTemplate", gmCreateTemplate);
  socket.register("gmUpdateTemplate", gmUpdateTemplate);
  socket.register("gmDeleteTemplate", gmDeleteTemplate);
  console.log("draw-sphere: socketlib ready");
});

Hooks.once("ready", () => {
  const wsUrl = game.settings.get("draw-sphere", "wsUrl");
  const activeUserName = game.settings.get("draw-sphere", "activeUserName");
  if (!wsUrl || !activeUserName || game.user.name !== activeUserName) return;
  if (!socket) { console.warn("draw-sphere: socketlib not ready"); return; }

  const ws = new WebSocket(wsUrl);

  ws.addEventListener("open", () => console.log("draw-sphere: WS connected", wsUrl));

  ws.addEventListener("message", async (event) => {
    const msg = parseMsg(event.data);
    if (!msg) {
      console.warn("draw-sphere: rejected message:", event.data.slice(0, 120));
      return;
    }
    if (msg.type === "marker_update") await handleUpdate(msg);
    else if (msg.type === "marker_lost") await handleLost(msg);
  });

  ws.addEventListener("close", () => {
    console.warn("draw-sphere: WS closed");
    active.clear();
    rulerPts.clear();
    rulerDocId = null;
  });

  ws.addEventListener("error", (err) => console.error("draw-sphere: WS error", err));
});
