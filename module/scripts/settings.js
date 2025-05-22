Hooks.once("init", () => {
  game.settings.register("draw-sphere", "wsUrl", {
    name: "WebSocket Server URL",
    hint: "Адрес WebSocket-сервера, например ws://raspberrypi.local:8765",
    scope: "world",
    config: true,
    type: String,
    default: "ws://localhost:8765"
  });
  game.settings.register("draw-sphere", "activeUserName", {
      name: "Имя активного пользователя",
      scope: "world",
      config: true,
      type: String,
      default: ""
  });
});