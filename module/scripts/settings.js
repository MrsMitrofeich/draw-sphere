Hooks.once("init", () => {
  game.settings.register("draw-sphere", "wsUrl", {
    name: "WebSocket Relay URL",
    hint: "Адрес relay-сервера из папки server/. Пример: ws://18.156.58.148:3000",
    scope: "world",
    config: true,
    type: String,
    default: "ws://localhost:3000",
  });

  game.settings.register("draw-sphere", "tvUserId", {
    name: "TV Player",
    hint: "Браузерная вкладка, показываемая на телевизоре. Координаты считаются по её viewport'у.",
    scope: "world",
    config: true,
    type: String,
    default: "",
    choices: {},
  });
});

Hooks.once("setup", () => {
  const setting = game.settings.settings.get("draw-sphere.tvUserId");
  const choices = { "": "— GM (по умолчанию) —" };
  for (const user of game.users) choices[user.id] = user.name;
  setting.choices = choices;
});
