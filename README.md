# Vehicle Parts Painting Mod

This repository contains a BeamNG.drive mod that enables per-part paint customization while playing in Freeroam. The mod introduces a dedicated UI app that lets you pick any installed vehicle part and assign individual paint parameters—matching the flexibility that previously existed only in Career mode.

Notice: Custom paint can be applied to any vehicle part, but **the color will only appear on parts that support painting**.

## Features

- **Freeroam-compatible part paints** – Apply unique paint definitions to every installed vehicle part without switching to Career mode.
- **Live part highlighting** – Selecting a part in the UI highlights it in the world for easy identification.
- **Full paint controls** – Adjust base color (including alpha), metallic, roughness, clearcoat and clearcoat roughness values for each paint slot.
- **Visibility recovery control** – A dedicated *Show whole vehicle* action restores every part instantly after isolating one for editing.
- **BeamNG-friendly color editing** – RGB sliders and numeric inputs replace the unsupported browser color picker, ensuring reliable in-game color selection.
- **Per-vehicle persistence during a session** – Custom paints are tracked on the active vehicle so they can be reapplied after respawns within the same play session.
- **Part search and filtering** – Quickly narrow down the part list by typing any portion of a part name, slot label, or identifier.
- **Responsive UI layout** – The app adjusts to the widget window, remaining usable from compact overlays to large panels.

## Installation

1. Copy the repository contents into your BeamNG user directory, e.g. `Documents/BeamNG.drive/mods/unpacked/vehicle-parts-painting/`.
2. Launch BeamNG.drive and enter Freeroam.
3. Open the UI layout editor, add the **Vehicle Parts Painting** app from the *Vehicle* category, and save your layout.

## Usage

1. Make sure the vehicle you want to edit is the active player vehicle.
2. Open the Vehicle Parts Painting app.
3. Select a part from the list on the left – use the search field to filter by name if needed. The part is highlighted in-game to help you locate it.
4. Use **Show whole vehicle** whenever you want to bring every part back into view (for example before closing the app).
5. Modify the paint values (RGB color, alpha, metallic, roughness, clearcoat, clearcoat roughness) for each paint slot.
6. Click **Apply paint to part** to push the changes to the vehicle. Use **Reset to vehicle paints** to revert to the current vehicle-wide paint scheme.

The mod adds a game-side Lua extension (`lua/ge/extensions/freeroam/vehiclePartsPainting.lua`) that bridges the UI app and the vehicle simulation, ensuring paints are validated and synchronized with the vehicle state.
