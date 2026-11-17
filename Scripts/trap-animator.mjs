const ID = "trap-animator";
const CHANNEL = `module.${ID}`;
const DART_TEXTURE = `modules/${ID}/art/dart.svg`;
const DEFAULT_SAVE_DC = 15;
const DART_WIDTH_PIXELS = 96;

Hooks.once("setupTileActions", (tiles) => {
  tiles.registerTileGroup(ID, "Trap Animator");
  tiles.registerTileAction(ID, "dartWall", {
    name: "Dart Wall",
    ctrls: [
      {
        id: "wall",
        name: "Launch Wall",
        type: "select",
        subtype: "entity",
        options: { show: [] },
        defaultType: "walls",
        restrict: (entity) => entity instanceof foundry.canvas.placeables.Wall,
        placeholder: "Select a wall on the scene",
        help: "The volley starts at the midpoint of this wall segment."
      },
      { id: "originX", name: "Launch X", type: "number", defvalue: "",
        help: "Used when no wall is selected. Leave both coordinates blank to fire from the midpoint of the tile’s left edge." },
      { id: "originY", name: "Launch Y", type: "number", defvalue: "" },
      { id: "requestSave", name: "Request Dexterity save", type: "checkbox", defvalue: true,
        conditional: () => game.system.id === "dnd5e" },
      { id: "saveDC", name: "Save DC", type: "number", min: 1, step: 1, defvalue: DEFAULT_SAVE_DC,
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
  const dc = getSaveDC(message.getFlag(ID, "saveDC"));
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
      await actor.rollSavingThrow({ ability: "dex", target: dc });
    } catch (error) {
      console.error("Trap Animator | Saving throw failed", error);
      ui.notifications.error("The dart wall saving throw could not be rolled.");
    } finally {
      button.disabled = false;
    }
  });
});

async function triggerDartWall({ tile, tokens = [], action, method }) {
  const scene = tile.parent;
  const gridSize = scene.dimensions.size;
  const settings = action.data ?? {};
  const wallUuid = settings.wall?.id;
  const wall = wallUuid ? scene.walls.get(wallUuid.split(".").at(-1)) : null;
  if (wallUuid && wall?.uuid !== wallUuid) {
    ui.notifications.warn("Trap Animator could not find the launch wall. Reopen the Dart Wall action and select a wall on this scene.");
    return;
  }
  const x = parseCoordinate(settings.originX);
  const y = parseCoordinate(settings.originY);
  // Foundry's tile position is its anchor. The shape supplies the actual scene center.
  const tileCenter = tile.shape.center;
  const halfWidth = Math.abs(tile.width) / 2;
  const rotation = tile.rotation * Math.PI / 180;
  const fallback = Number.isFinite(x) && Number.isFinite(y)
    ? { x, y }
    : {
      x: tileCenter.x - halfWidth * Math.cos(rotation),
      y: tileCenter.y - halfWidth * Math.sin(rotation)
    };

  let launch = fallback;
  let wallSpread;
  if (wall) {
    const [x0, y0, x1, y1] = wall.c;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = Math.hypot(dx, dy);
    const spread = length ? Math.min(gridSize * 0.14 / length, 0.5) : 0;
    launch = { x: x0 + dx / 2, y: y0 + dy / 2 };
    wallSpread = { x: dx * spread, y: dy * spread };
  }

  for (const token of new Set(tokens)) {
    if (!(token instanceof CONFIG.Token.documentClass) || token.parent !== scene) continue;
    const center = token.getCenterPoint();
    const target = method === "enter"
      ? { x: tileCenter.x, y: tileCenter.y, elevation: center.elevation }
      : center;
    const effect = { sceneId: scene.id, tokenId: token.id, origin: launch, target, wallSpread };
    game.socket.emit(CHANNEL, effect);
    playOnViewedScene(effect);

    if (game.system.id === "dnd5e" && (settings.requestSave ?? true)) {
      await requestDexteritySave(token, getSaveDC(settings.saveDC));
    }
  }
}

function parseCoordinate(value) {
  if (value == null || String(value).trim() === "") return NaN;
  return Number(value);
}

function getSaveDC(value) {
  const dc = typeof value === "string" ? Number(value) : value;
  return Number.isSafeInteger(dc) && dc > 0 ? dc : DEFAULT_SAVE_DC;
}

async function requestDexteritySave(token, dc) {
  const actor = token.actor;
  if (typeof actor?.rollSavingThrow !== "function" || !actor.system.abilities?.dex) return;
  const whisper = game.users
    .filter((user) => user.isGM || actor.testUserPermission(user, "OWNER"))
    .map((user) => user.id);
  if (!whisper.length) return;

  const ChatMessage = CONFIG.ChatMessage.documentClass;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ scene: token.parent, token, actor, alias: token.name }),
    content: `<p><strong>Dart Wall</strong> &middot; Make a DC ${dc} Dexterity saving throw.</p>
      <button type="button" data-trap-animator-save>Roll Dexterity Save</button>`,
    whisper,
    flags: { [ID]: { saveToken: token.uuid, saveDC: dc } }
  });
}

function playOnViewedScene(effect) {
  if (!canvas.ready || !effect || canvas.scene.id !== effect.sceneId) return;
  const { origin, target, tokenId, wallSpread } = effect;
  const token = canvas.scene.tokens.get(tokenId);
  if (!token) return;
  if (!game.user.isGM && (token.hidden || (!token.isOwner && !token.object?.isVisible))) return;
  if (![origin?.x, origin?.y, target?.x, target?.y, target?.elevation].every(Number.isFinite)) return;

  const spread = [wallSpread?.x, wallSpread?.y].every(Number.isFinite) ? wallSpread : undefined;
  playVolley(origin, target, canvas.dimensions.size, spread).catch((error) => {
    console.error("Trap Animator | Dart volley failed", error);
  });
}

async function playVolley(origin, target, gridSize, wallSpread) {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const distance = Math.hypot(dx, dy);
  if (!Number.isFinite(distance) || distance < 1) return;

  const scene = canvas.scene;
  const layer = canvas.interface;
  const texture = await foundry.canvas.loadTexture(DART_TEXTURE);
  if (!texture?.width) throw new Error("Dart texture could not be loaded.");

  const spreadX = -dy / distance * gridSize * 0.14;
  const spreadY = dx / distance * gridSize * 0.14;
  const duration = Math.min(650, Math.max(180, 110 * distance / gridSize));
  const { CanvasAnimation } = foundry.canvas.animation;

  await Promise.all([-1, 0, 1].map(async (lane, index) => {
    if (index) await new Promise(resolve => setTimeout(resolve, index * 70));
    if (!canvas.ready || canvas.scene !== scene || canvas.interface !== layer || layer.destroyed) return;

    const startX = origin.x + lane * (wallSpread?.x ?? spreadX);
    const startY = origin.y + lane * (wallSpread?.y ?? spreadY);
    const endX = target.x + lane * spreadX * 0.35;
    const endY = target.y + lane * spreadY * 0.35;
    const dart = new PIXI.Sprite(texture);
    dart.eventMode = "none";
    dart.anchor.set(0.5);
    dart.scale.set(DART_WIDTH_PIXELS / texture.width);
    dart.position.set(startX, startY);
    dart.rotation = Math.atan2(endY - startY, endX - startX);

    // The interface group renders above Foundry's wall, lighting, and fog effects.
    try {
      layer.addChild(dart);
      await CanvasAnimation.animate([
        { parent: dart, attribute: "x", to: endX },
        { parent: dart, attribute: "y", to: endY }
      ], { duration, easing: t => t });
    } finally {
      if (!dart.destroyed) dart.destroy();
    }
  }));
}
