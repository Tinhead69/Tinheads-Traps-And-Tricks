# Trap Animator

Animated dart walls and opening pit traps for Foundry VTT v14, D&D 5e, and Monk’s Active Tile Triggers 14.01 or later.

## Install or update

Use this manifest in Foundry’s Install Module dialog, or update the installed module and reload the world.

https://raw.githubusercontent.com/Tinhead69/Tinheads-Traps-And-Tricks/main/module.json

GitHub generates the download archive from the main branch. Enable Trap Animator and Monk’s Active Tile Triggers in your world. Keep a GM connected while players resolve saves and the GM applies consequences.

## Tile setup

Place a tile over the trigger area. Set Triggers → Setup to Active, Enter, and Min. Required to Trigger 0. Save with Update Tile. The tile’s Active checkbox also lets the GM disarm and rearm a trap.

## Dart Wall

Add Trap Animator → Dart Wall to the tile’s Actions.

Choose a Launch Wall to fire from its midpoint. You can also enter Launch X and Launch Y in scene pixels. With those fields blank, darts launch from the midpoint of the tile’s left edge. They aim at the triggering token’s movement destination. Tile size and rotation are taken into account.

Enable Request Dexterity save and set Save DC. Enter a Damage on failed save formula such as 1d6 + 2, then choose its damage type. A blank formula deals no damage. Existing traps retain their previous save DC and acquire no damage until the GM configures it.

For poisoned darts, enable Require a follow-up save on failure. Choose the follow-up ability, DC, damage formula/type, and condition. For example, a failed Dexterity save can cause piercing damage followed by a Constitution save against poison damage and the Poisoned condition. Conditions persist until the GM clears them according to the trap’s rules.

## Pit Trap

Use a visible floor tile with opacity 1, sized to cover the pit opening. An image matching the surrounding floor provides a concealed trap before it opens. A transparent tile also works over map artwork.

Add Trap Animator → Pit Trap. Set the Dexterity save DC and the pit depth in feet. A black opening expands across the floor tile when it triggers and persists in the scene. A successful save avoids the configured consequences. The GM handles where the character stands after avoiding the pit.

Default failed-save damage is 1d6 bludgeoning per full 10 feet of depth, capped at 20d6. A 5-foot pit has no default damage, a 20-foot pit deals 2d6, and a 30-foot pit deals 3d6. Use Fall damage override for house rules or special pits, including 0 for no damage. When applied fall damage reduces hit points or temporary hit points, the character is also marked Prone.

This version uses depth to calculate damage. Moving tokens onto lower levels is deferred. It does not invoke the D&D 5e falling indicator or its separate fall-damage card.

To close a pit, create a separate control tile with a click trigger and add Trap Animator → Close / Reset Pit. Select the original pit in Pit tile to reset. Triggering this action restores its original floor texture. Keep this reset action on the separate control tile so the entry action can leave the pit open.

## Saves and consequences

The token’s owners and the GM receive a whispered save card. Roll using its button to use the entering character’s actor, even when another token is selected. A total at or above the configured DC succeeds. Cancelling the roll dialog leaves the card pending.

On a failed save, a GM clicks Apply Consequences. The module rolls the configured damage and passes typed damage to the D&D 5e actor, allowing the system to handle resistances, immunities, vulnerabilities, temporary hit points, and hit points. A configured follow-up save is posted after the first consequences are applied. Its damage and condition are applied by the GM from that second result card if it fails.

Each result card applies once. If application is interrupted by an error, its card is marked for GM review and further automatic application is blocked. Check the damage roll and actor state, then finish any remaining effects manually to avoid applying damage twice. Account for features such as Slow Fall or other special mitigation before applying the result.

Movement pausing from 0.1.14 has been removed. New trap saves do not pause or cancel token movement. Older save cards are migrated to the current card format when the active GM loads the world.

## Validation

Automated regression checks cover action registration, pit opening/reset, depth-based damage, save success/failure/cancellation, typed damage, follow-up saves and conditions, repeat/concurrent application, interrupted application, and dart destination targeting. Rendering and multiplayer behavior require a live Foundry world check.
