const ID = "trap-animator";
const CHANNEL = `module.${ID}`;
const DART_TEXTURE = `modules/${ID}/art/dart.svg`;
const SAVE_DC = 15;

Hooks.once("init", () => {
  CONFIG.Canvas.vfx.enabled = true;
});

Hooks.once("setupTileActions", (tiles) => {
  tiles.registerTileGroup(ID, "Trap Animator");
  tiles.registerTileAction(ID, "dartWall", {
    name: "Dart Wall",
    ctrls: [
      { id: "originX", name: "Launch X", type: "number", defvalue: "",
        help: "Scene pixels. Leave both coordinates blank to fire from just left of the tile." },
      { id: "originY", name: "Launch Y", type: "number", defvalue: "" },
      { id: "requestSave", name: "Request DC 15 Dexterity save", type: "checkbox", defvalue: true,
        conditional: () => game.system.id === "dnd5e" }
    ],
    fn: triggerDartWall,
    content: async () => '<span class="action-style">Dart Wall</span>'
  });
});

Hooks.once("ready", () => {
  game.socket.on(CHANNEL, playOnViewedScene);
});

Hooks.on("renderChatMessageHTML", (message, html) => {
  const tokenUuid = message.getFlag(ID, "saveToken");
  const button = html.querySelector("[data-trap-animator-save]");
  if (!tokenUuid || !button || game.system.id !== "dnd5e") return;

  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const token = await fromUuid(tokenUuid);
      const actor = token?.actor;
      if (!actor?.isOwner || typeof actor.rollSavingThrow !== "function") {
        ui.notifications.warn("You need ownership of the triggering character to roll this save.");
        return;
      }
      await actor.rollSavingThrow({ ability: "dex", target: SAVE_DC });
    } catch (error) {
      console.error("Trap Animator | Saving throw failed", error);
      ui.notifications.error("The dart wall saving throw could not be rolled.");
    } finally {
      button.disabled = false;
    }
  });
});

async function triggerDartWall({ tile, tokens = [], action, pt, method }) {
  const scene = tile.parent;
  const gridSize = scene.dimensions.size;
  const settings = action.data ?? {};
  const x = parseCoordinate(settings.originX);
  const y = parseCoordinate(settings.originY);
  const launch = Number.isFinite(x) && Number.isFinite(y)
    ? { x, y }
    : { x: Math.min(tile.x, tile.x + tile.width) - gridSize * 0.2, y: tile.y + tile.height / 2 };

  for (const token of new Set(tokens)) {
    if (token.documentName !== "Token" || token.parent !== scene) continue;
    const center = token.getCenterPoint();
    const target = method === "enter" && Number.isFinite(pt?.x) && Number.isFinite(pt?.y)
      ? { x: pt.x, y: pt.y, elevation: center.elevation }
      : center;
    const effect = { sceneId: scene.id, tokenId: token.id, origin: launch, target };
    game.socket.emit(CHANNEL, effect);
    playOnViewedScene(effect);

    if (game.system.id === "dnd5e" && (settings.requestSave ?? true)) {
      await requestDexteritySave(token);
    }
  }
}

function parseCoordinate(value) {
  if (value == null || String(value).trim() === "") return NaN;
  return Number(value);
}

async function requestDexteritySave(token) {
  const actor = token.actor;
  if (typeof actor?.rollSavingThrow !== "function" || !actor.system.abilities?.dex) return;
  const whisper = game.users
    .filter((user) => user.isGM || actor.testUserPermission(user, "OWNER"))
    .map((user) => user.id);
  if (!whisper.length) return;

  const ChatMessage = CONFIG.ChatMessage.documentClass;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ scene: token.parent, token, actor, alias: token.name }),
    content: `<p><strong>Dart Wall</strong> &middot; Make a DC ${SAVE_DC} Dexterity saving throw.</p>
      <button type="button" data-trap-animator-save>Roll Dexterity Save</button>`,
    whisper,
    flags: { [ID]: { saveToken: token.uuid } }
  });
}

function playOnViewedScene(effect) {
  if (!canvas.ready || !effect || canvas.scene.id !== effect.sceneId) return;
  const { origin, target, tokenId } = effect;
  const token = canvas.scene.tokens.get(tokenId);
  if (!token || (token.hidden && !game.user.isGM)) return;
  if (![origin?.x, origin?.y, target?.x, target?.y, target?.elevation].every(Number.isFinite)) return;

  playVolley({ ...origin, elevation: target.elevation }, target, canvas.dimensions.size).catch((error) => {
    console.error("Trap Animator | Dart volley failed", error);
  });
}

async function playVolley(origin, target, gridSize) {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const distance = Math.hypot(dx, dy);
  if (!Number.isFinite(distance) || distance < 1) return;

  const spreadX = -dy / distance * gridSize * 0.14;
  const spreadY = dx / distance * gridSize * 0.14;
  const duration = Math.min(650, Math.max(180, 110 * distance / gridSize));
  const components = {};
  const timeline = [];

  for (const [index, lane] of [-1, 0, 1].entries()) {
    const component = `dart${index}`;
    components[component] = {
      type: "singleAttack",
      pathType: "linear",
      path: [{
        ...origin,
        x: origin.x + lane * spreadX,
        y: origin.y + lane * spreadY
      }, {
        ...target,
        x: target.x + lane * spreadX * 0.35,
        y: target.y + lane * spreadY * 0.35
      }],
      projectile: {
        texture: DART_TEXTURE,
        duration,
        size: { w: gridSize * 0.58, h: gridSize * 0.58 / 3 },
        animations: [{ function: "followPath", params: {} }]
      }
    };
    timeline.push({ component, position: index * 70 });
  }

  const effect = new foundry.canvas.vfx.VFXEffect({ name: "Dart Wall", components, timeline });
  await effect.play();
}
