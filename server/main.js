import WebSocket from 'ws';

const PORT = process.env.PORT || 8765;

const wss = new WebSocket.Server({ port: PORT }, () => {
  console.log(`🟢 draw-sphere WebSocket-сервер запущен на 0.0.0.0:${PORT}`);
});

const clients = new Set();

wss.on('connection', (ws) => {
  console.log("🔌 Клиент подключён");
  clients.add(ws);

  ws.on('message', (message) => {
    console.log("📨 Получено сообщение:", message.toString());

    // Рассылка всем клиентам (включая Foundry)
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message.toString());
      }
    }
  });

  ws.on('close', () => {
    console.log("🔌 Клиент отключился");
    clients.delete(ws);
  });

  ws.on('error', (err) => {
    console.error("❌ Ошибка клиента:", err);
  });
});

wss.on('error', (err) => {
  console.error("❌ Ошибка WebSocket-сервера:", err);
});