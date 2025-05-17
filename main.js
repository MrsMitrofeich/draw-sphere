import WebSocket from "ws";

Hooks.once("ready", () => {
  const port = 8765;
  const socket = socketlib.getSocket("draw-sphere");

  // 🟢 Запуск WebSocket-сервера
  const wss = new WebSocket.Server({ port, host: "0.0.0.0" });

  console.log(`🟢 [draw-sphere] WebSocket-сервер запущен на 0.0.0.0:${port}`);

  wss.on("connection", (ws) => {
    console.log("🔌 [draw-sphere] Подключился клиент");

    ws.on("message", async (msg) => {
      try {
        const data = JSON.parse(msg);
        console.log("📨 [draw-sphere] Получено сообщение:", data);

        const { type, payload } = data;
        const gm = game.users.find(u => u.active && u.isGM);

        if (!gm) {
          console.warn("⚠️ [draw-sphere] Нет активного ГМа — отрисовка невозможна");
          return;
        }

        await socket.executeForUser(gm.id, type, payload);
      } catch (error) {
        console.error("❌ [draw-sphere] Ошибка при обработке сообщения:", error);
      }
    });

    ws.on("close", () => {
      console.log("🔌 [draw-sphere] Клиент отключился");
    });
  });

  wss.on("error", (err) => {
    console.error("❌ [draw-sphere] Ошибка WebSocket-сервера:", err);
  });
});