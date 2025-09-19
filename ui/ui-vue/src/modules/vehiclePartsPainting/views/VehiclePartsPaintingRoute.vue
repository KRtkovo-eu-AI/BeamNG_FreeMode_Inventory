<template>
  <div class="vehicle-parts-painting-modal">
    <div class="vehicle-parts-painting-modal__backdrop" @click="close" />
    <section
      ref="dialog"
      class="vehicle-parts-painting-modal__dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vehiclePartsPaintingInstructionsTitle"
      tabindex="-1"
      @click.stop
    >
      <header class="vehicle-parts-painting-modal__header">
        <h1 class="vehicle-parts-painting-modal__title" id="vehiclePartsPaintingInstructionsTitle">
          Vehicle Parts Painting
        </h1>
        <button
          ref="closeButton"
          type="button"
          class="vehicle-parts-painting-modal__dismiss"
          aria-label="Close instructions"
          @click="close"
        >
          <span aria-hidden="true">&times;</span>
        </button>
      </header>
      <p class="vehicle-parts-painting-modal__intro">
        Go to the UI Apps menu, search for Vehicle Parts Painting app, add it, position it and resize it as you like, and finally save your layout.
      </p>
      <h2 class="vehicle-parts-painting-modal__section-title">Usage</h2>
      <ol class="vehicle-parts-painting-modal__steps">
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
      <footer class="vehicle-parts-painting-modal__actions">
        <button type="button" class="vehicle-parts-painting-modal__action" @click="close">
          Close
        </button>
      </footer>
    </section>
  </div>
</template>

<script>
export default {
  name: 'VehiclePartsPaintingRoute',
  data() {
    return {
      hasClosed: false,
    }
  },
  mounted() {
    this.hasClosed = false
    this.runLua('extensions.load("ui_topBar_vehiclePartsPainting")')
    this.runLua('extensions.load("freeroam_vehiclePartsPainting")')
    this.runLua('freeroam_vehiclePartsPainting.open()')
    this.runLua('ui_topBar.setActiveItem("vehiclePartsPainting")')

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.handleKeydown)
    }

    this.$nextTick(() => {
      const dialog = this.$refs.dialog
      if (dialog && typeof dialog.focus === 'function') {
        try {
          dialog.focus()
        } catch (err) {
          this.logDebug('VehiclePartsPaintingRoute: unable to focus dialog container.', err)
        }
      }

      const closeButton = this.$refs.closeButton
      if (closeButton && typeof closeButton.focus === 'function') {
        try {
          closeButton.focus()
        } catch (errButton) {
          this.logDebug('VehiclePartsPaintingRoute: unable to focus close button.', errButton)
        }
      }
    })
  },
  beforeUnmount() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.handleKeydown)
    }

    this.runLua('freeroam_vehiclePartsPainting.close()')
    this.runLua('ui_topBar.setActiveItem("")')
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
    close(event) {
      if (event && typeof event.preventDefault === 'function') { event.preventDefault() }
      if (event && typeof event.stopPropagation === 'function') { event.stopPropagation() }
      if (this.hasClosed) { return }

      const navigated = this.navigateBack()
      if (!navigated) { return }

      this.hasClosed = true
      this.runLua('freeroam_vehiclePartsPainting.close()')
      this.runLua('ui_topBar.setActiveItem("")')
    },
    handleKeydown(event) {
      if (!event) { return }
      const key = event.key || event.keyCode
      if (key === 'Escape' || key === 'Esc' || key === 27) {
        if (typeof event.preventDefault === 'function') { event.preventDefault() }
        this.close(event)
      }
    },
    navigateBack() {
      const router = this.$router
      if (router) {
        try {
          if (typeof router.back === 'function') {
            router.back()
            return true
          }
        } catch (errBack) {
          this.logDebug('VehiclePartsPaintingRoute: unable to navigate back via router.', errBack)
        }

        const fallbackNames = ['menu.mainmenu', 'menu.home', 'menu']
        if (typeof router.hasRoute === 'function') {
          for (const name of fallbackNames) {
            try {
              if (router.hasRoute(name)) {
                router.push({ name })
                return true
              }
            } catch (errNamed) {
              this.logDebug(`VehiclePartsPaintingRoute: unable to navigate to named route ${name}.`, errNamed)
            }
          }
        }

        const fallbackPaths = ['/menu', '/']
        for (const path of fallbackPaths) {
          try {
            router.push(path)
            return true
          } catch (errPath) {
            this.logDebug(`VehiclePartsPaintingRoute: unable to navigate to path ${path}.`, errPath)
          }
        }
      }

      if (typeof window !== 'undefined' && window.history && typeof window.history.back === 'function') {
        window.history.back()
        return true
      }

      return false
    },
    logDebug(message, detail) {
      if (typeof window !== 'undefined' && window.console && typeof window.console.debug === 'function') {
        window.console.debug(message, detail)
      }
    },
  },
}
</script>

<style scoped>
.vehicle-parts-painting-modal {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  box-sizing: border-box;
  pointer-events: auto;
  color: #fff;
  font-family: inherit;
  z-index: 10;
}

.vehicle-parts-painting-modal__backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.72);
}

.vehicle-parts-painting-modal__dialog {
  position: relative;
  width: min(680px, 100%);
  max-height: min(760px, calc(100vh - 96px));
  background: rgba(18, 18, 18, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 12px;
  padding: 32px 36px;
  box-sizing: border-box;
  box-shadow: 0 32px 64px rgba(0, 0, 0, 0.55);
  display: flex;
  flex-direction: column;
  gap: 20px;
  overflow-y: auto;
  outline: none;
}

.vehicle-parts-painting-modal__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.vehicle-parts-painting-modal__title {
  margin: 0;
  font-size: 26px;
  font-weight: 600;
}

.vehicle-parts-painting-modal__dismiss {
  background: transparent;
  border: none;
  color: inherit;
  font-size: 22px;
  cursor: pointer;
  padding: 4px;
  line-height: 1;
  border-radius: 6px;
  transition: background 0.2s ease, color 0.2s ease;
}

.vehicle-parts-painting-modal__dismiss:hover,
.vehicle-parts-painting-modal__dismiss:focus {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.vehicle-parts-painting-modal__dismiss span {
  display: block;
  font-weight: 600;
}

.vehicle-parts-painting-modal__intro {
  margin: 0;
  font-size: 16px;
  line-height: 1.6;
}

.vehicle-parts-painting-modal__section-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.vehicle-parts-painting-modal__steps {
  margin: 0;
  padding-left: 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 15px;
  line-height: 1.6;
}

.vehicle-parts-painting-modal__steps li::marker {
  font-weight: 600;
}

.vehicle-parts-painting-modal__actions {
  margin-top: 8px;
  display: flex;
  justify-content: flex-end;
}

.vehicle-parts-painting-modal__action {
  appearance: none;
  background: #ff7f0e;
  border: none;
  border-radius: 8px;
  color: #0f0f0f;
  cursor: pointer;
  font-size: 15px;
  font-weight: 600;
  padding: 10px 20px;
  transition: background 0.2s ease, color 0.2s ease, transform 0.2s ease;
}

.vehicle-parts-painting-modal__action:hover,
.vehicle-parts-painting-modal__action:focus {
  background: #ffa23d;
  color: #000;
}

.vehicle-parts-painting-modal__action:active {
  transform: translateY(1px);
}

@media (max-width: 720px) {
  .vehicle-parts-painting-modal {
    padding: 32px 16px;
  }

  .vehicle-parts-painting-modal__dialog {
    padding: 28px 24px;
  }

  .vehicle-parts-painting-modal__title {
    font-size: 24px;
  }

  .vehicle-parts-painting-modal__intro {
    font-size: 15px;
  }
}

@media (max-width: 480px) {
  .vehicle-parts-painting-modal__dialog {
    padding: 24px 20px;
    gap: 16px;
  }

  .vehicle-parts-painting-modal__steps {
    font-size: 14px;
  }
}
</style>
