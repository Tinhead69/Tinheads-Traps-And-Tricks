import { saveControls, damageControls, damageConfig, validateConsequences, requestTrapSave } from "./trap-saves.mjs";
import { registerPitActions } from "./pit-trap.mjs";

const ID = "trap-animator";
const CHANNEL = `module.${ID}`;
const DART_TEXTURE = `modules/${ID}/art/dart.svg`;
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
      ...saveControls,
      ...damageControls
    ],
    fn: triggerDartWall,
    content: async () => '<span class="action-style">Dart Wall</span>'
  });
  registerPitActions(tiles);
});

Hooks.once("ready", () => {
  game.socket.on(CHANNEL, playOnViewedScene);
});

async function triggerDartWall({ tile, tokens = [], action, stopdata, method }) {
  const scene = tile.parent;
  const gridSize = scene.dimensions.size;
  const settings = action.data ?? {};
  const consequences = damageConfig(settings);
  if (game.system.id === "dnd5e") validateConsequences(consequences);
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
    const isMovementTrigger = ["enter", "exit", "movement", "stop"].includes(method);
    const monkDestination = stopdata?.document?.id === token.id ? stopdata.dest : null;
    const destination = [
      monkDestination,
      isMovementTrigger ? token.movement?.destination : null
    ].find(point => Number.isFinite(point?.x) && Number.isFinite(point?.y));
    const target = token.getCenterPoint(destination ?? {});
    const effect = { sceneId: scene.id, tokenId: token.id, origin: launch, target, wallSpread };
    game.socket.emit(CHANNEL, effect);
    playOnViewedScene(effect);

    if (game.system.id === "dnd5e" && (settings.requestSave ?? true)) {
      await requestTrapSave(token, { ...consequences, title: "Dart Wall", ability: "dex", dc: settings.saveDC });
    }
  }
}

function parseCoordinate(value) {
  if (value == null || String(value).trim() === "") return NaN;
  return Number(value);
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
  const stage = canvas.stage;
  const texture = await foundry.canvas.loadTexture(DART_TEXTURE);
  if (!texture?.width) throw new Error("Dart texture could not be loaded.");
  if (!canvas.ready || canvas.scene !== scene || canvas.stage !== stage) return;
  const layer = new PIXI.Container();
  layer.eventMode = "none";
  layer.zIndex = Number.MAX_SAFE_INTEGER;
  stage.addChild(layer);
  stage.sortChildren();

  const spreadX = -dy / distance * gridSize * 0.14;
  const spreadY = dx / distance * gridSize * 0.14;
  const duration = Math.min(650, Math.max(180, 110 * distance / gridSize));
  const { CanvasAnimation } = foundry.canvas.animation;

  try {
    await Promise.all([-1, 0, 1].map(async (lane, index) => {
    if (index) await new Promise(resolve => setTimeout(resolve, index * 70));
    if (!canvas.ready || canvas.scene !== scene || canvas.stage !== stage || layer.destroyed) return;

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

    try {
      // This container is a sibling above all scene groups, including tokens.
      layer.addChild(dart);
      await CanvasAnimation.animate([
        { parent: dart, attribute: "x", to: endX },
        { parent: dart, attribute: "y", to: endY }
      ], { duration, easing: t => t });
    } finally {
      if (!dart.destroyed) dart.destroy();
    }
    }));
  } finally {
    if (!layer.destroyed) layer.destroy({ children: true });
  }
}

