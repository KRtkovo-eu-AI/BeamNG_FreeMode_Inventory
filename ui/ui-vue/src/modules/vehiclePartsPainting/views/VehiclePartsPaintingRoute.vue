<template>
  <div class="vehicle-parts-painting-route" role="main" aria-labelledby="vehiclePartsPaintingInstructionsTitle">
    <section class="vehicle-parts-painting-route__panel">
      <header class="vehicle-parts-painting-route__header">
        <h1 class="vehicle-parts-painting-route__title" id="vehiclePartsPaintingInstructionsTitle">
          Vehicle Parts Painting
        </h1>
        <p class="vehicle-parts-painting-route__intro">
          Go to the UI Apps menu, search for Vehicle Parts Painting app, add it, position it and resize it as you like, and finally save your layout.
        </p>
      </header>
      <h2 class="vehicle-parts-painting-route__section-title">Usage</h2>
      <ol class="vehicle-parts-painting-route__steps">
        <li>Make sure the vehicle you want to edit is the active player vehicle.</li>
        <li>Open the Vehicle Parts Painting app.</li>
        <li>
          Select a part from the list on the left – use the search field to filter by name if needed. The part is highlighted in-game
          to help you locate it.
        </li>
        <li>Use Show whole vehicle whenever you want to bring every part back into view (for example before closing the app).</li>
        <li>Modify the paint values (RGB color, alpha, metallic, roughness, clearcoat, clearcoat roughness) for each paint slot.</li>
        <li>
          Click Apply paint to part to push the changes to the vehicle. Use Reset to vehicle paints to revert to the current vehicle-wide
          paint scheme.
        </li>
      </ol>
    </section>
  </div>
</template>

<script>
export default {
  name: 'VehiclePartsPaintingRoute',
  mounted() {
    this.runLua('extensions.load("ui_topBar_vehiclePartsPainting")')
    this.runLua('extensions.load("freeroam_vehiclePartsPainting")')
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
  },
}
</script>

<style scoped>
.vehicle-parts-painting-route {
  position: absolute;
  inset: 0;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 96px 32px 48px;
  box-sizing: border-box;
  overflow-y: auto;
  pointer-events: auto;
  color: #fff;
  font-family: inherit;
}

.vehicle-parts-painting-route__panel {
  width: min(720px, 100%);
  background: rgba(18, 18, 18, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 12px;
  padding: 36px 40px;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.55);
  display: flex;
  flex-direction: column;
  gap: 20px;
  box-sizing: border-box;
}

.vehicle-parts-painting-route__title {
  margin: 0;
  font-size: 26px;
  font-weight: 600;
}

.vehicle-parts-painting-route__intro {
  margin: 12px 0 0;
  font-size: 16px;
  line-height: 1.6;
}

.vehicle-parts-painting-route__section-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.vehicle-parts-painting-route__steps {
  margin: 0;
  padding-left: 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 15px;
  line-height: 1.6;
}

.vehicle-parts-painting-route__steps li::marker {
  font-weight: 600;
}

@media (max-width: 900px) {
  .vehicle-parts-painting-route {
    padding: 88px 20px 32px;
  }

  .vehicle-parts-painting-route__panel {
    padding: 28px 26px;
  }

  .vehicle-parts-painting-route__title {
    font-size: 22px;
  }

  .vehicle-parts-painting-route__intro {
    font-size: 15px;
  }
}

@media (max-width: 520px) {
  .vehicle-parts-painting-route {
    padding: 80px 16px 24px;
  }

  .vehicle-parts-painting-route__panel {
    padding: 24px 20px;
    gap: 16px;
  }

  .vehicle-parts-painting-route__steps {
    font-size: 14px;
  }
}
</style>
