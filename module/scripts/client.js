// 🔁 Перевод относительных координат (0..1) в координаты сцены
function relativeToSceneCoords(relX, relY) {
  const screenX = relX * window.innerWidth;
  const screenY = relY * window.innerHeight;
  const t = canvas.stage.worldTransform;
  const x = (screenX - t.tx) / t.a;
  const y = (screenY - t.ty) / t.d;
  return { x, y };
}

const drawnOnce = new Set();

// ⭕ Окружность
async function drawCircle({ x, y, radius = 20, fillColor = "#FF0000", id }) {
  if (!canvas?.scene) return null;
  const data = {
    _id: id,
    t: "circle",
    user: game.user.id,
    x,
    y,
    distance: radius,
    direction: 0,
    angle: 360,
    fillColor,
    flags: { "draw-sphere": true }
  };
  const [template] = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [data]);
  drawnOnce.add(template?.id);
  return template?.id;
}

// 🔺 Конус
async function drawCone({ x, y, distance = 20, angle = 60, direction = 0, fillColor = "#FF8800", id }) {
  if (!canvas?.scene) return null;
  const data = {
    _id: id,
    t: "cone",
    user: game.user.id,
    x,
    y,
    distance,
    direction,
    angle,
    fillColor,
    flags: { "draw-sphere": true }
  };
  const [template] = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [data]);
  drawnOnce.add(template?.id);
  return template?.id;
}

// ◼️ Квадрат
async function drawSquare({ x, y, size = 20, fillColor = "#00FF00", id }) {
  if (!canvas?.scene) return null;
  const gridSize = canvas.scene.dimensions.size;
  const gridDistance = canvas.scene.dimensions.distance;
  const sizePx = size * gridSize / gridDistance;

  const data = {
    _id: id,
    t: "rect",
    user: game.user.id,
    x: x - sizePx / 2,
    y: y - sizePx / 2,
    distance: size * Math.sqrt(2),
    direction: 45,
    fillColor,
    flags: { "draw-sphere": true }
  };
  const [template] = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [data]);
  drawnOnce.add(template?.id);
  return template?.id;
}

// ➖ Луч
async function drawRay({ x1, y1, x2, y2, width = 5, fillColor = "#00AAFF", id }) {
  if (!canvas?.scene) return null;
  const grid = canvas.scene.dimensions;
  const scale = grid.distance / grid.size;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const distanceFt = Math.sqrt(dx ** 2 + dy ** 2) * scale;
  let direction = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (direction < 0) direction += 360;

  const data = {
    _id: id,
    t: "ray",
    user: game.user.id,
    x: x1,
    y: y1,
    distance: distanceFt,
    direction,
    width,
    fillColor,
    flags: { "draw-sphere": true }
  };
  const [template] = await canvas.scene.createEmbeddedDocuments("MeasuredTemplate", [data]);
  drawnOnce.add(template?.id);
  return template?.id;
}

// ❌ Удаление шаблона
async function removeTemplate({ id }) {
  if (!canvas?.scene) return;
  const template = canvas.scene.templates.get(id);
  if (template) {
    await canvas.scene.deleteEmbeddedDocuments("MeasuredTemplate", [id]);
    drawnOnce.delete(id);
  }
}

// 📦 Глобальный сокет
let socket;

// 🔌 Регистрация socketlib
Hooks.once("socketlib.ready", () => {
  socket = socketlib.registerModule("draw-sphere");

  socket.register("drawCircle", drawCircle, false);
  socket.register("drawCone", drawCone, false);
  socket.register("drawSquare", drawSquare, false);
  socket.register("drawRay", drawRay, false);
  socket.register("removeTemplate", removeTemplate, false);

  console.log("✅ draw-sphere: socketlib зарегистрирован");
});

// 🌐 WebSocket только у активного клиента
Hooks.once("ready", () => {
  const wsUrl = game.settings.get("draw-sphere", "wsUrl");
  const activeUserName = game.settings.get("draw-sphere", "activeUserName");

  if (!wsUrl || !activeUserName) return;

  if (game.user.name !== activeUserName) {
    console.log("ℹ️ draw-sphere: клиент не активный, WS не используется");
    return;
  }

  if (!socket) {
    console.warn("⚠️ draw-sphere: socketlib ещё не готов");
    return;
  }

  const ws = new WebSocket(wsUrl);

  ws.addEventListener("open", () => {
    console.log("🔌 draw-sphere: WebSocket подключен:", wsUrl);
  });

  ws.addEventListener("message", async (event) => {
    try {
      const { type, payload } = JSON.parse(event.data);
      if (!type || !payload) return;

      // Преобразование относительных координат → абсолютные
      if ("relX" in payload && "relY" in payload) {
        const { x, y } = relativeToSceneCoords(payload.relX, payload.relY);
        payload.x = x;
        payload.y = y;
      }
      if ("relX1" in payload && "relY1" in payload && "relX2" in payload && "relY2" in payload) {
        const p1 = relativeToSceneCoords(payload.relX1, payload.relY1);
        const p2 = relativeToSceneCoords(payload.relX2, payload.relY2);
        payload.x1 = p1.x;
        payload.y1 = p1.y;
        payload.x2 = p2.x;
        payload.y2 = p2.y;
      }

      await socket.executeAsGM(type, payload);
    } catch (err) {
      console.error("❌ draw-sphere: ошибка обработки WS-сообщения:", err);
    }
  });

  ws.addEventListener("close", () => {
    console.warn("🛑 draw-sphere: WebSocket отключен");
  });

  ws.addEventListener("error", (err) => {
    console.error("❌ draw-sphere: ошибка WebSocket:", err);
  });
});