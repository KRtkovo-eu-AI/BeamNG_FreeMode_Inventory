<template>
  <div
    class="vehicle-parts-painting-topbar-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="vehiclePartsPaintingTopbarTitle"
    @click="close"
  >
    <section class="vehicle-parts-painting-topbar-dialog__content" @click.stop>
      <header class="vehicle-parts-painting-topbar-dialog__header">
        <h2 class="vehicle-parts-painting-topbar-dialog__title" id="vehiclePartsPaintingTopbarTitle">
          Vehicle Parts Painting
        </h2>
      </header>
      <p class="vehicle-parts-painting-topbar-dialog__intro">
        Go to the UI Apps menu, search for Vehicle Parts Painting app, add it, position it and resize it as you like, and finally save your layout.
      </p>
      <h3 class="vehicle-parts-painting-topbar-dialog__section-title">Usage</h3>
      <ol class="vehicle-parts-painting-topbar-dialog__steps">
        <li>Make sure the vehicle you want to edit is the active player vehicle.</li>
        <li>Open the Vehicle Parts Painting app.</li>
        <li>Select a part from the list on the left – use the search field to filter by name if needed. The part is highlighted in-game to help you locate it.</li>
        <li>Use Show whole vehicle whenever you want to bring every part back into view (for example before closing the app).</li>
        <li>Modify the paint values (RGB color, alpha, metallic, roughness, clearcoat, clearcoat roughness) for each paint slot.</li>
        <li>Click Apply paint to part to push the changes to the vehicle. Use Reset to vehicle paints to revert to the current vehicle-wide paint scheme.</li>
      </ol>
      <div class="vehicle-parts-painting-topbar-dialog__actions">
        <button type="button" class="vehicle-parts-painting-topbar-dialog__button" @click="close">
          Close
        </button>
      </div>
    </section>
  </div>
</template>

<script>
export default {
  name: 'VehiclePartsPaintingRoute',
  mounted() {
    this.runLua('extensions.load("ui_topBar_vehiclePartsPainting")')
    this.runLua('extensions.load("freeroam_vehiclePartsPainting")')
    this.runLua('ui_topBar.setActiveItem("vehiclePartsPainting")')
  },
  beforeUnmount() {
    this.runLua('freeroam_vehiclePartsPainting.close()')
  },
  methods: {
    runLua(code) {
      if (!code || typeof window === 'undefined') { return }
      const api = window.bngApi
      if (!api || typeof api.engineLua !== 'function') { return }
      try {
        api.engineLua(code)
      } catch (err) {
        if (window.console && typeof window.console.warn === 'function') {
          window.console.warn('VehiclePartsPaintingRoute: failed to run Lua command.', code, err)
        }
      }
    },
    close() {
      this.runLua('freeroam_vehiclePartsPainting.close()')
      if (window && window.history && typeof window.history.back === 'function') {
        window.history.back()
      }
    },
  },
}
</script>

<style scoped>
.vehicle-parts-painting-topbar-dialog {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;
  background: rgba(0, 0, 0, 0.6);
  z-index: 2000;
  color: #fff;
  box-sizing: border-box;
  font-family: inherit;
}

.vehicle-parts-painting-topbar-dialog__content {
  background: rgba(18, 18, 18, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 8px;
  padding: 26px 30px;
  width: min(720px, 100%);
  max-height: calc(100% - 96px);
  overflow-y: auto;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.vehicle-parts-painting-topbar-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.vehicle-parts-painting-topbar-dialog__title {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
}

.vehicle-parts-painting-topbar-dialog__intro {
  font-size: 15px;
  line-height: 1.5;
  margin: 0;
}

.vehicle-parts-painting-topbar-dialog__section-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.vehicle-parts-painting-topbar-dialog__steps {
  margin: 0;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 14px;
  line-height: 1.5;
}

.vehicle-parts-painting-topbar-dialog__steps li {
  margin-left: 4px;
}

.vehicle-parts-painting-topbar-dialog__actions {
  display: flex;
  justify-content: flex-end;
}

.vehicle-parts-painting-topbar-dialog__button {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.18);
  color: #fff;
  border-radius: 4px;
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}

.vehicle-parts-painting-topbar-dialog__button:hover,
.vehicle-parts-painting-topbar-dialog__button:focus {
  background: rgba(255, 255, 255, 0.18);
  border-color: rgba(255, 255, 255, 0.32);
  outline: none;
}

.vehicle-parts-painting-topbar-dialog__button:active {
  background: rgba(255, 255, 255, 0.26);
}

@media (max-width: 720px) {
  .vehicle-parts-painting-topbar-dialog {
    padding: 24px 16px;
  }

  .vehicle-parts-painting-topbar-dialog__content {
    padding: 22px 20px;
  }
}
</style>
