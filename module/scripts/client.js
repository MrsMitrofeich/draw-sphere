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
async function drawCircle({ relX, relY, radius = 20, fillColor = "#FF0000", id }) {
  if (!canvas?.scene) return null;
  const { x, y } = relativeToSceneCoords(relX, relY);

  const data = {
    _id: id,
    t: "circle",
    user: game.user.id,
    x, y,
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
async function drawCone({ relX, relY, distance = 20, angle = 60, direction = 0, fillColor = "#FF8800", id }) {
  if (!canvas?.scene) return null;
  const { x, y } = relativeToSceneCoords(relX, relY);

  const data = {
    _id: id,
    t: "cone",
    user: game.user.id,
    x, y,
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
async function drawSquare({ relX, relY, size = 20, fillColor = "#00FF00", id }) {
  if (!canvas?.scene) return null;
  const { x, y } = relativeToSceneCoords(relX, relY);
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
async function drawRay({ relX1, relY1, relX2, relY2, width = 5, fillColor = "#00AAFF", id }) {
  if (!canvas?.scene) return null;
  const { x: x1, y: y1 } = relativeToSceneCoords(relX1, relY1);
  const { x: x2, y: y2 } = relativeToSceneCoords(relX2, relY2);

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

// 📦 Глобальная переменная сокета
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

// 🌐 Подключение к внешнему WebSocket-серверу
Hooks.once("ready", () => {
  const wsUrl = game.settings.get("draw-sphere", "wsUrl");

  if (!wsUrl) {
    console.warn("⚠️ draw-sphere: wsUrl не задан");
    return;
  }

  if (!socket) {
    console.warn("⚠️ draw-sphere: socketlib сокет ещё не готов");
    return;
  }

  const ws = new WebSocket(wsUrl);

  ws.addEventListener("open", () => {
    console.log("🔌 draw-sphere: WebSocket подключен:", wsUrl);
  });

ws.addEventListener("message", async (event) => {
  try {
    const { requestId, type, payload } = JSON.parse(event.data);
    const result = await socket.executeAsGM(type, payload);

    // Отправляем результат обратно на сервер
    ws.send(JSON.stringify({ requestId, result }));
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