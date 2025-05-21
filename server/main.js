const WebSocket = require("ws");

const PORT = process.env.PORT || 8765;
const wss = new WebSocket.Server({ port: PORT }, () => {
  console.log(`🟢 draw-sphere WebSocket-сервер запущен на 0.0.0.0:${PORT}`);
});

const clients = new Set();
const pendingRequests = new Map(); // requestId -> ws

wss.on("connection", (ws) => {
  console.log("🔌 Клиент подключён");
  clients.add(ws);

  ws.on("message", (messageBuffer) => {
    const raw = messageBuffer.toString();
    console.log("📨 Получено сообщение:", raw);

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error("❌ Ошибка парсинга JSON:", err);
      return;
    }

    const { requestId, result } = parsed;

    // 🔁 Это ОТВЕТ от клиента (например, браузера)
    if (requestId && result !== undefined) {
      const requester = pendingRequests.get(requestId);
      if (requester && requester.readyState === WebSocket.OPEN) {
        requester.send(JSON.stringify({ requestId, result }));
        pendingRequests.delete(requestId);
        console.log(`🔙 Ответ отправлен обратно (requestId: ${requestId})`);
      } else {
        console.warn(`⚠️ Неизвестный или закрытый клиент для requestId ${requestId}`);
      }
      return;
    }

    // 📤 Это ЗАПРОС — запоминаем, кто его прислал
    if (requestId) {
      pendingRequests.set(requestId, ws);
    }

    // 🚀 Рассылаем всем другим клиентам
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN && client !== ws) {
        client.send(raw);
      }
    }
  });

  ws.on("close", () => {
    console.log("🔌 Клиент отключился");
    clients.delete(ws);

    // Чистим все requestId, где ws уже невалиден
    for (const [requestId, requester] of pendingRequests.entries()) {
      if (requester === ws) {
        pendingRequests.delete(requestId);
      }
    }
  });

  ws.on("error", (err) => {
    console.error("❌ Ошибка клиента:", err);
  });
});

wss.on("error", (err) => {
  console.error("❌ Ошибка WebSocket-сервера:", err);
});