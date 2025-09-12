# BeamNG FreeMode Inventory

This repository contains resources for building a part inventory feature for BeamNG.drive.

- `careerPartInventory` contains the original career mode implementation for reference.
- `uiAppTemplate` provides a minimal AngularJS app template.
- `freeroamPartInventory` is a new mod that exposes a part inventory system in Free Roam mode through a UI app.

The Free Roam mod adds a simple part inventory where removed parts can be stored and later installed on vehicles of the same model. The UI app can be added to the UI layout in game and communicates with the accompanying Lua extension.

From the UI app players can open the standard vehicle configuration menu. When parts are removed via this menu they are automatically added to the inventory with basic information such as the slot, part name and vehicle colour.

