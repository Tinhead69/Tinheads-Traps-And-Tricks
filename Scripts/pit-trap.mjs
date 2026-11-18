import { positiveInteger, requestTrapSave } from "./trap-saves.mjs";

const ID = "trap-animator";
const BLACK_TEXTURE = `modules/${ID}/art/pit.svg`;
const opening = new Set();
const animations = new Set();

export function pitDamage(depth) {
  const dice = Math.min(20, Math.floor(depth / 10));
  return dice ? `${dice}d6` : "";
}

export function registerPitActions(tiles) {
  tiles.registerTileAction(ID, "pitTrap", {
    name: "Pit Trap",
    ctrls: [
      { id: "saveDC", name: "Dexterity save DC", type: "number", min: 1, step: 1, defvalue: 15 },
      { id: "depth", name: "Pit depth (feet)", type: "number", min: 1, step: 1, defvalue: 10,
        help: "Failed save: 1d6 bludgeoning per full 10 ft, maximum 20d6. GM applies the result." },
      { id: "damageFormula", name: "Fall damage override", type: "text", defvalue: "",
        help: "Leave blank to calculate damage from depth. Enter 0 for no damage." }
    ],
    fn: triggerPit,
    content: async () => '<span class="action-style">Pit Trap</span>'
  });
  tiles.registerTileAction(ID, "resetPit", {
    name: "Close / Reset Pit",
    ctrls: [{ id: "pitTile", name: "Pit tile to reset", type: "select", subtype: "entity",
      defaultType: "tiles", options: { show: ["tile"] },
      restrict: entity => entity instanceof foundry.canvas.placeables.Tile,
      help: "Select the floor tile. Leave blank to reset this tile." }],
    fn: async ({ tile, action }) => {
      const id = action.data?.pitTile?.id;
      const target = id && id !== "tile" ? await fromUuid(id) : tile;
      if (!(target instanceof CONFIG.Tile.documentClass)) throw new Error("Select a pit floor tile to reset.");
      const pit = target.getFlag(ID, "pit");
      if (!pit) return;
      await target.update({ texture: pit.texture, ["flags." + ID + ".-=pit"]: null });
    },
    content: async () => '<span class="action-style">Close / Reset Pit</span>'
  });
}

export async function triggerPit({ tile, tokens = [], action }) {
  if (game.system.id !== "dnd5e") throw new Error("Pit Trap requires the D&D 5e system.");
  const targets = [...new Set(tokens)].filter(token => token instanceof CONFIG.Token.documentClass && token.parent === tile.parent);
  if (!targets.length) return;
  const depth = positiveInteger(action.data?.depth, 10);
  const formula = String(action.data?.damageFormula ?? "").trim() || pitDamage(depth);
  if (formula && !Roll.validate(formula)) throw new Error("The pit damage formula is invalid.");
  await openPit(tile);
  for (const token of targets) await requestTrapSave(token, {
    title: "Pit Trap", ability: "dex", dc: positiveInteger(action.data?.saveDC),
    formula, damageType: "bludgeoning", depth, proneOnDamage: true
  });
}

export async function openPit(tile) {
  if (tile.getFlag(ID, "pit") || opening.has(tile.uuid)) return;
  opening.add(tile.uuid);
  try {
    const pit = { texture: foundry.utils.deepClone(tile.texture), openedAt: Date.now() };
    await tile.update({ texture: { src: BLACK_TEXTURE, fit: "fill", scaleX: 1, scaleY: 1, tint: "#ffffff" }, ["flags." + ID + ".pit"]: pit });
  } finally { opening.delete(tile.uuid); }
}

Hooks.on("updateTile", (tile, changes) => {
  if (!foundry.utils.getProperty(changes, "flags." + ID + ".pit")) return;
  animateOpening(tile).catch(error => console.error("Trap Animator | Pit opening failed", error));
});

export function pitOpeningCorners(tile, progress) {
  const center = tile.shape.center;
  const halfWidth = Math.abs(tile.width) * Math.max(0, Math.min(1, progress)) / 2;
  const halfHeight = Math.abs(tile.height) / 2;
  const angle = tile.rotation * Math.PI / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [[-halfWidth, -halfHeight], [halfWidth, -halfHeight],
    [halfWidth, halfHeight], [-halfWidth, halfHeight]].map(([x, y]) => ({
    x: center.x + x * cosine - y * sine,
    y: center.y + x * sine + y * cosine
  }));
}

export async function animateOpening(tile) {
  if (!canvas.ready || canvas.scene.id !== tile.parent.id || !tile.object || animations.has(tile.uuid)) return;
  animations.add(tile.uuid);
  let mesh;
  let mask;
  let previousMask;
  try {
    await tile.object.draw();
    if (!tile.getFlag(ID, "pit")) return;
    mesh = tile.object.mesh;
    if (!mesh || mesh.destroyed || !mesh.parent) return;
    previousMask = mesh.mask;
    mask = new PIXI.Graphics();
    mask.eventMode = "none";
    mesh.parent.addChild(mask);
    const state = { progress: 0.01 };
    const redraw = () => {
      if (mask.destroyed || mesh.destroyed) return;
      const points = pitOpeningCorners(tile, state.progress).flatMap(point => {
        const local = mask.parent.toLocal(canvas.stage.toGlobal(point));
        return [local.x, local.y];
      });
      mask.clear().beginFill(0xffffff).drawPolygon(points).endFill();
    };
    redraw();
    mesh.mask = mask;
    await foundry.canvas.animation.CanvasAnimation.animate([
      { parent: state, attribute: "progress", to: 1 }
    ], { duration: 650, easing: time => time, ontick: redraw });
  } finally {
    if (mesh && !mesh.destroyed && mask && mesh.mask === mask) mesh.mask = previousMask;
    if (mask && !mask.destroyed) mask.destroy();
    animations.delete(tile.uuid);
  }
}
