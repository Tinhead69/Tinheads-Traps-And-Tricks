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
    await tile.update({ texture: { src: BLACK_TEXTURE, scaleX: 1, scaleY: 1, tint: "#ffffff" }, ["flags." + ID + ".pit"]: pit });
  } finally { opening.delete(tile.uuid); }
}

Hooks.on("updateTile", (tile, changes) => {
  if (!foundry.utils.getProperty(changes, "flags." + ID + ".pit")) return;
  animateOpening(tile).catch(error => console.error("Trap Animator | Pit opening failed", error));
});

export async function animateOpening(tile) {
  if (!canvas.ready || canvas.scene.id !== tile.parent.id || !tile.object || animations.has(tile.uuid)) return;
  animations.add(tile.uuid);
  let mesh;
  let scale;
  try {
    await tile.object.draw();
    if (!tile.getFlag(ID, "pit")) return;
    mesh = tile.object.mesh;
    if (!mesh || mesh.destroyed) return;
    scale = mesh.scale.x;
    mesh.scale.x = scale * 0.01;
    await foundry.canvas.animation.CanvasAnimation.animate([
      { parent: mesh.scale, attribute: "x", to: scale }
    ], { duration: 650, easing: time => time });
  } finally {
    if (mesh && !mesh.destroyed && scale !== undefined) mesh.scale.x = scale;
    animations.delete(tile.uuid);
  }
}
