# Trap Animator

Trap Animator adds a **Dart Wall** action to Monk’s Active Tile Triggers. When a token enters the trigger tile, three darts fly from the wall toward the token’s entry point. In D&D 5e, the action whispers a **DC 15 Dexterity saving throw** to the token’s owners and the GM. The button opens the standard save dialog for the triggering token’s actor. The GM can resolve damage separately.

## Install

1. Use Foundry VTT v14 and Monk’s Active Tile Triggers 14.01 or later.
2. Extract the ZIP into your Foundry user data directory’s `Data/modules` folder. The manifest should end up at `Data/modules/trap-animator/module.json`.
3. Restart Foundry if it was running. Launch your world and enable **Trap Animator** and **Monk’s Active Tile Triggers** under **Game Settings → Manage Modules**.

## Place a dart wall

1. Place a tile over the area that should trigger the trap. If you want a concealed trigger, use a transparent tile image.
2. Open the tile settings, enable Monk’s triggers for the tile, and choose **Enter**.
3. In the tile’s **Actions**, add **Trap Animator → Dart Wall**. Keep **Request DC 15 Dexterity save** checked. If you already use Monk’s TokenBar to request the save, uncheck this option and put your existing roll request after the Dart Wall action.
4. In **Launch Wall**, activate the picker and select the wall segment in the scene’s Walls layer. The volley starts at the midpoint and follows the wall if you move it. If you leave the wall unset, enter **Launch X** and **Launch Y** in scene pixels or leave them blank to fire from just left of the tile.
5. Save the tile. Move a player-owned token across the tile edge. The three darts should appear for clients viewing the scene, and the token’s player and the GM should receive the chat prompt. Click **Roll Dexterity Save** to verify it opens the entering character’s save dialog.

The animation uses Foundry v14’s experimental native VFX API. The save request uses the D&D 5e system’s native roll dialog, with no additional roll-request module required.
