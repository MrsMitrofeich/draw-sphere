Hooks.once("init", () => {
  game.settings.register("draw-sphere", "wsUrl", {
    name: "WebSocket Relay URL",
    hint: "Адрес relay-сервера из папки server/. Пример: ws://localhost:3000",
    scope: "world",
    config: true,
    type: String,
    default: "ws://localhost:3000",
  });
});
