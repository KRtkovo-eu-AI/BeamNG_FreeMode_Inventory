# Vehicle Parts Painting Top Bar Integration Plan

## Observations from the base UI

* The Vue top bar store keeps the registered items in a dictionary that is sorted by `order` and matched against either `targetState` or a `substate` prefix when determining which button is active. Hidden state filtering relies on flag arrays such as `inGameOnly`, `noMission`, or `noScenario`.【F:.beamng/orig-0.36/ui/ui/ui-vue/src/services/topBar.js†L29-L145】
* The store only starts listening once the `ui_topBar` Lua extension is loaded, then pulls the initial payload through `Lua.ui_topBar.requestData()` and expects future updates via the extension events (e.g. `ui_topBar_entriesChanged`).【F:.beamng/orig-0.36/ui/ui/ui-vue/src/services/topBar.js†L244-L258】
* Freeroam currently exposes vehicle-related options in Angular under the `menu.vehicleconfig.*` states, each mapped to `/vehicle-config` URLs and toggling the UI apps layer as needed.【F:.beamng/orig-0.36/ui/ui/entrypoints/main/main.js†L440-L461】
* The legacy dash menu still defines section breakpoints for Freeroam in front of `menu.vehicleconfig.parts`, `menu.environment`, `menu.photomode`, and `menu.options.graphics`, which gives us a natural insertion point for another vehicle-focused tool.【F:.beamng/orig-0.36/ui/ui/entrypoints/main/main.js†L2026-L2030】
* The Vue router marks the `menu.vehicleconfig` branch with `topBar.visible = true`, signalling that top bar buttons should remain available while those views are shown.【F:.beamng/orig-0.36/ui/ui/ui-vue/src/modules/vehicleConfig/routes.js†L17-L33】

## Current app structure

* The `vehiclePartsPainting` Angular directive already bundles all UI logic and can be embedded inside another template by rendering the `<vehicle-parts-painting>` element.【F:ui/modules/apps/vehiclePartsPainting/app.js†L1-L40】

## Proposed changes

1. **Lua: extend the top bar inventory**
   * Ship a small helper extension (e.g. `lua/ge/extensions/ui_topBar_vehiclePartsPainting.lua`) that waits for `ui_topBar` to load, clones the existing item table, and registers a new entry such as:
     ```lua
     local item = {
       id = "vehiclePartsPainting",
       label = "vehiclePartsPainting.topbarLabel",
       icon = "engine",
       targetState = "menu.vehiclePartsPainting",
       substate = "menu.vehiclePartsPainting",
       order = 250,
       flags = {"inGameOnly", "noMission", "noScenario", "noGarage"}
     }
     ```
   * When our extension loads, call into `extensions.ui_topBar` to append the item and emit `entriesChanged` so the store refreshes. Also register listeners for removal when unloading to keep the list clean.

2. **Angular state & template wrapper**
   * Provide a module (e.g. `ui/modules/menu/menu-vehiclePartsPainting.js`) that runs during Angular bootstrap and registers a new `$stateProvider.state('menu.vehiclePartsPainting', …)` mirroring the `menu.vehicleconfig` setup:
     * URL `/vehicle-parts-painting`.
     * `template` containing `<vehicle-parts-painting ui-sref-opts="{ inherit: true }"></vehicle-parts-painting>` with a lightweight controller that keeps the scope alive.
     * `uiAppsShown: true` so the existing HUD layout remains visible.
     * `backState: "BACK_TO_MENU"` for consistent navigation.

3. **Vue route bridging**
   * Add a small router module under `ui/modules/...` that exports a `/vehicle-parts-painting` route (`name: "menu.vehiclePartsPainting"`) with `meta.topBar.visible = true`. This ensures the Vue layout keeps the top bar active when our state is selected.

4. **Translations & assets**
   * Register a translation key (e.g. `vehiclePartsPainting.topbarLabel`) so the new button shows a localized caption, and reuse the existing app icon or add a simple SVG if needed.

5. **Lifecycle coordination**
   * When the Angular state is entered, request `Lua.vehiclePartsPainting.open()` to populate the directive just like the app version does today. When leaving, notify Lua so per-vehicle state can be released.

Implementing these steps will add a dedicated “Vehicle Parts Painting” button next to the existing Freeroam vehicle tools, open our UI inside a menu frame similar to Vehicle Configuration, and keep the experience consistent with the current top bar conventions.
