const ID = "trap-animator";
const CHANNEL = `module.${ID}`;
const resolving = new Set();
const applying = new Set();

export const saveControls = [
  { id: "requestSave", name: "Request Dexterity save", type: "checkbox", defvalue: true },
  { id: "saveDC", name: "Save DC", type: "number", min: 1, step: 1, defvalue: 15 }
];

const abilities = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };
const damageTypes = () => Object.fromEntries(Object.entries(CONFIG.DND5E.damageTypes).map(([key, value]) => [key, value.label ?? value]));

export const damageControls = [
  { id: "damageFormula", name: "Damage on failed save", type: "text", defvalue: "", help: "For example 1d6 + 2. Leave blank for no damage." },
  { id: "damageType", name: "Damage type", type: "list", list: damageTypes, defvalue: "piercing" },
  { id: "followup", name: "Require a follow-up save on failure", type: "checkbox", defvalue: false },
  { id: "followupAbility", name: "Follow-up save ability", type: "list", list: () => abilities, defvalue: "con" },
  { id: "followupDC", name: "Follow-up save DC", type: "number", min: 1, step: 1, defvalue: 15 },
  { id: "followupDamage", name: "Follow-up damage on failure", type: "text", defvalue: "" },
  { id: "followupDamageType", name: "Follow-up damage type", type: "list", list: damageTypes, defvalue: "poison" },
  { id: "followupCondition", name: "Condition on failed follow-up save", type: "list", defvalue: "poisoned",
    list: () => ({ "": "None", poisoned: "Poisoned", prone: "Prone", restrained: "Restrained", blinded: "Blinded", paralyzed: "Paralyzed" }) }
];

export function positiveInteger(value, fallback = 15) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

export function damageConfig(settings) {
  const config = {
    formula: String(settings.damageFormula ?? "").trim(),
    damageType: settings.damageType || "piercing"
  };
  if (settings.followup) config.followup = {
    ability: settings.followupAbility || "con",
    dc: positiveInteger(settings.followupDC),
    formula: String(settings.followupDamage ?? "").trim(),
    damageType: settings.followupDamageType || "poison",
    condition: settings.followupCondition ?? "poisoned"
  };
  return config;
}

function escapeHTML(text) {
  return String(text).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

export function cardContent(data) {
  const ability = abilities[data.ability] || "Dexterity";
  let content = `<p><strong>${escapeHTML(data.title)}</strong></p>`;
  if (!data.outcome) content += `<p>DC ${data.dc} ${ability} saving throw.</p><button type="button" data-trap-save>Roll ${ability} Save</button>`;
  else content += `<p>${data.outcome === "success" ? "Save succeeded" : "Save failed"}${Number.isFinite(data.total) ? ` (${data.total} against DC ${data.dc})` : ""}.</p>`;
  if (data.outcome === "failure") {
    if (data.formula) content += `<p>Damage on failure: ${escapeHTML(data.formula)} ${escapeHTML(data.damageType)}.</p>`;
    if (data.depth) content += `<p>Pit depth: ${data.depth} ft.</p>`;
    if (data.condition) content += `<p>Condition: ${escapeHTML(data.condition)}. The GM clears it when appropriate.</p>`;
    if (data.followup) content += `<p>Follow-up: DC ${data.followup.dc} ${escapeHTML(abilities[data.followup.ability] || "Constitution")} save.</p>`;
    if (hasConsequences(data)) content += data.application
      ? `<p>${data.application === "done" ? "Consequences applied." : data.application === "error" ? "Application interrupted. GM must review the actor and finish any remaining effects manually." : "Applying consequences…"}</p>`
      : '<button type="button" data-trap-apply>GM: Apply Consequences</button>';
  }
  return content;
}

function hasConsequences(data) {
  return Boolean(data.formula || data.condition || data.followup);
}

export async function requestTrapSave(token, config) {
  if (game.system.id !== "dnd5e" || typeof token.actor?.rollSavingThrow !== "function") {
    throw new Error("Trap saves require a D&D 5e actor with saving throws.");
  }
  validateConsequences(config);
  const data = { ...config, tokenUuid: token.uuid, ability: config.ability || "dex", dc: positiveInteger(config.dc) };
  const whisper = game.users.filter(user => user.isGM || token.actor.testUserPermission(user, "OWNER")).map(user => user.id);
  const ChatMessage = CONFIG.ChatMessage.documentClass;
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ scene: token.parent, token, actor: token.actor, alias: token.name }),
    content: cardContent(data), whisper,
    flags: { [ID]: { trap: data } }
  });
}

export function validateConsequences(data) {
  for (const formula of [data.formula, data.followup?.formula]) {
    if (formula && !Roll.validate(formula)) throw new Error(`Invalid trap damage formula: ${formula}`);
  }
  for (const type of [data.formula && data.damageType, data.followup?.formula && data.followup.damageType]) {
    if (type && !CONFIG.DND5E.damageTypes[type]) throw new Error(`Unknown damage type: ${type}`);
  }
  if (data.followup && !abilities[data.followup.ability]) throw new Error("Choose a valid follow-up save ability.");
}

Hooks.on("renderChatMessageHTML", (message, html) => {
  const data = message.getFlag(ID, "trap");
  if (!data) return;
  const saveButton = html.querySelector("[data-trap-save]");
  saveButton?.addEventListener("click", async () => {
    saveButton.disabled = true;
    try {
      if (message.getFlag(ID, "trap").outcome) return;
      if (!game.users.activeGM) throw new Error("A GM must be connected to resolve trap saves.");
      const token = await fromUuid(data.tokenUuid);
      if (!token?.actor?.isOwner) throw new Error("You need ownership of the triggering character to roll this save.");
      await token.actor.rollSavingThrow({ ability: data.ability, target: data.dc }, {}, {
        data: { flags: { [ID]: { trapSaveRequest: message.id } } }
      });
    } catch (error) { reportError(error); }
    finally { saveButton.disabled = Boolean(message.getFlag(ID, "trap").outcome); }
  });
  const applyButton = html.querySelector("[data-trap-apply]");
  if (applyButton && !game.user.isGM) applyButton.remove();
  else applyButton?.addEventListener("click", () => {
    applyButton.disabled = true;
    if (!game.users.activeGM) return reportError(new Error("A GM must be connected to apply trap consequences."));
    if (game.user.isActiveGM) applyConsequences(message).catch(reportError);
    else game.socket.emit(CHANNEL, { type: "applyTrap", requestId: message.id, userId: game.user.id });
  });
});

Hooks.once("ready", () => {
  game.socket.on(CHANNEL, data => {
    if (data?.type !== "applyTrap" || !game.user.isActiveGM || !game.users.get(data.userId)?.isGM) return;
    const request = game.messages.get(data.requestId);
    if (request) applyConsequences(request).catch(reportError);
  });
});

Hooks.on("createChatMessage", message => { resolveSave(message).catch(reportError); });

export async function resolveSave(rollMessage) {
  if (!game.user.isActiveGM) return;
  const requestId = rollMessage.getFlag(ID, "trapSaveRequest");
  const request = game.messages.get(requestId);
  const data = request?.getFlag(ID, "trap");
  if (!data || data.outcome || resolving.has(requestId)) return;
  resolving.add(requestId);
  try {
    const token = await fromUuid(data.tokenUuid);
    if (!rollMessage.author || !token?.actor?.testUserPermission(rollMessage.author, "OWNER")) return;
    const roll = rollMessage.rolls?.[0];
    if (!Number.isFinite(roll?.total)) return;
    await updateCard(request, { ...data, total: roll.total, outcome: roll.total >= data.dc ? "success" : "failure", rollId: rollMessage.id });
  } finally { resolving.delete(requestId); }
}

async function updateCard(message, data) {
  await message.update({ ["flags." + ID + ".trap"]: data, content: cardContent(data) });
}

export async function applyConsequences(message) {
  const data = message.getFlag(ID, "trap");
  if (!game.user.isActiveGM || !data || data.outcome !== "failure" || data.application || applying.has(message.id)) return;
  applying.add(message.id);
  let claimed = false;
  try {
    const token = await fromUuid(data.tokenUuid);
    if (!token?.actor) throw new Error("The triggering token no longer exists.");
    validateConsequences(data);
    await updateCard(message, { ...data, application: "running" });
    claimed = true;
    let actualDamage = 0;
    if (data.formula) {
      const roll = await new Roll(data.formula, token.actor.getRollData()).evaluate();
      if (!Number.isFinite(roll.total)) throw new Error("The damage roll did not produce a finite total.");
      await roll.toMessage({ flavor: escapeHTML(data.title) + " damage", whisper: message.whisper });
      const hp = token.actor.system.attributes.hp;
      const before = Number(hp.value) + Number(hp.temp || 0);
      await token.actor.applyDamage([{ value: Math.max(0, roll.total), type: data.damageType }]);
      const after = token.actor.system.attributes.hp;
      actualDamage = before - Number(after.value) - Number(after.temp || 0);
    }
    const condition = data.condition || (data.proneOnDamage && actualDamage > 0 ? "prone" : "");
    if (condition && !token.actor.system.traits?.ci?.value?.has(condition)) {
      await token.actor.toggleStatusEffect(condition, { active: true });
    }
    if (data.followup) await requestTrapSave(token, { ...data.followup, title: data.title + " — follow-up save" });
    await updateCard(message, { ...data, application: "done" });
  } catch (error) {
    if (claimed) await updateCard(message, { ...data, application: "error" });
    throw error;
  } finally { applying.delete(message.id); }
}

function reportError(error) {
  console.error("Trap Animator |", error);
  ui.notifications.error(error.message || "Trap Animator could not complete the action.");
}

// Cards from 0.1.x used separate flags and may contain an unfinished movement hold.
Hooks.once("ready", async () => {
  for (const message of game.messages) {
    const tokenUuid = message.getFlag(ID, "saveToken");
    if (!tokenUuid || message.getFlag(ID, "trap")) continue;
    try {
      const hold = message.getFlag(ID, "movementHold");
      if (hold?.userId === game.user.id) {
        const token = await fromUuid(tokenUuid);
        if (token?.movement?.id === hold.movementId) token.resumeMovement(hold.movementId, hold.key);
      }
      if (!game.user.isActiveGM) continue;
      const data = { title: "Dart Wall", ability: "dex", dc: positiveInteger(message.getFlag(ID, "saveDC")),
        tokenUuid, outcome: message.getFlag(ID, "outcome") };
      await message.update({ ["flags." + ID + ".trap"]: data,
        ["flags." + ID + ".-=movementHold"]: null, content: cardContent(data) });
    } catch (error) { reportError(error); }
  }
});
