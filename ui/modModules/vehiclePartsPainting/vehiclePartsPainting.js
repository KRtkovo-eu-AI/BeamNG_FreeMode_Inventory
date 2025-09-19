import '/ui/modules/menu/menu-vehiclePartsPainting.js'

const MODULE_NAME = 'vehiclePartsPainting'
const STYLE_ELEMENT_ID = 'vehicle-parts-painting-modal-styles'
const ROUTE_NAME = 'menu.vehiclePartsPainting'
const ROUTE_PATH = '/vehicle-parts-painting'

function ensureAngularModule() {
  if (typeof angular === 'undefined' || !angular.module) { return }
  try {
    angular.module(MODULE_NAME)
  } catch (err) {
    angular.module(MODULE_NAME, [])
  }
}

function ensureStylesInjected() {
  if (typeof document === 'undefined') { return }
  if (document.getElementById(STYLE_ELEMENT_ID)) { return }

  const style = document.createElement('style')
  style.id = STYLE_ELEMENT_ID
  style.type = 'text/css'
  style.textContent = `
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

.vehicle-parts-painting-modal__dismiss:focus,
.vehicle-parts-painting-modal__dismiss:hover {
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
`
  document.head.appendChild(style)
}

function runLua(code) {
  if (!code) { return }
  try {
    const api = (typeof window !== 'undefined' && window.bngApi) ? window.bngApi : null
    if (!api || typeof api.engineLua !== 'function') { return }
    api.engineLua(code)
  } catch (err) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('VehiclePartsPainting: failed to run Lua command.', code, err)
    }
  }
}

function getRouter() {
  if (typeof document === 'undefined') { return null }
  const root = document.getElementById('vue-app')
  if (!root) { return null }

  const app = root.__vue_app__
  if (!app) { return null }

  if (app.config && app.config.globalProperties && app.config.globalProperties.$router) {
    return app.config.globalProperties.$router
  }

  if (app._context && app._context.provides) {
    const providers = app._context.provides
    if (providers.router) { return providers.router }
    for (const key of Object.keys(providers)) {
      const candidate = providers[key]
      if (candidate && typeof candidate.replace === 'function' && typeof candidate.push === 'function') {
        return candidate
      }
    }
  }

  return null
}

function routerHasRoute(router, name) {
  if (!router) { return false }
  if (typeof router.hasRoute === 'function') {
    try {
      return router.hasRoute(name)
    } catch (err) {
      return false
    }
  }

  if (typeof router.getRoutes === 'function') {
    try {
      return router.getRoutes().some(route => route && route.name === name)
    } catch (err) {
      return false
    }
  }

  return false
}

function navigateBackWithRouter(router) {
  if (!router) { return false }
  try {
    if (typeof router.back === 'function') {
      router.back()
      return true
    }
  } catch (err) {
    if (typeof console !== 'undefined' && console.debug) {
      console.debug('VehiclePartsPainting: router.back failed, attempting fallbacks.', err)
    }
  }

  const namedFallbacks = ['menu.mainmenu', 'menu.home', 'menu']
  if (typeof router.hasRoute === 'function' && typeof router.push === 'function') {
    for (const name of namedFallbacks) {
      try {
        if (router.hasRoute(name)) {
          router.push({ name })
          return true
        }
      } catch (err) {
        if (typeof console !== 'undefined' && console.debug) {
          console.debug('VehiclePartsPainting: unable to navigate to named route', name, err)
        }
      }
    }
  }

  const pathFallbacks = ['/menu', '/']
  if (typeof router.push === 'function') {
    for (const path of pathFallbacks) {
      try {
        router.push(path)
        return true
      } catch (err) {
        if (typeof console !== 'undefined' && console.debug) {
          console.debug('VehiclePartsPainting: unable to navigate to path', path, err)
        }
      }
    }
  }

  return false
}

function createInstructionsComponent(Vue) {
  const { defineComponent, ref, onMounted, onBeforeUnmount, nextTick } = Vue
  const steps = [
    'Make sure the vehicle you want to edit is the active player vehicle.',
    'Open the Vehicle Parts Painting app.',
    'Select a part from the list on the left \u2013 use the search field to filter by name if needed. The part is highlighted in-game to help you locate it.',
    'Use Show whole vehicle whenever you want to bring every part back into view (for example before closing the app).',
    'Modify the paint values (RGB color, alpha, metallic, roughness, clearcoat, clearcoat roughness) for each paint slot.',
    'Click Apply paint to part to push the changes to the vehicle. Use Reset to vehicle paints to revert to the current vehicle-wide paint scheme.',
  ]

  return defineComponent({
    name: 'VehiclePartsPaintingInstructions',
    setup() {
      const hasClosed = ref(false)
      const dialog = ref(null)
      const closeButton = ref(null)

      const handleDialogClick = event => {
        if (event && typeof event.stopPropagation === 'function') {
          event.stopPropagation()
        }
      }

      const close = event => {
        if (event) {
          if (typeof event.preventDefault === 'function') { event.preventDefault() }
          if (typeof event.stopPropagation === 'function') { event.stopPropagation() }
        }

        if (hasClosed.value) { return }

        const router = getRouter()
        const navigated = navigateBackWithRouter(router) || (typeof window !== 'undefined' && window.history && typeof window.history.back === 'function' && (window.history.back(), true))
        if (!navigated) { return }

        hasClosed.value = true
        runLua('freeroam_vehiclePartsPainting.close()')
        runLua('ui_topBar.setActiveItem("")')
      }

      const handleBackdropClick = event => {
        if (event) {
          if (typeof event.preventDefault === 'function') { event.preventDefault() }
          if (typeof event.stopPropagation === 'function') { event.stopPropagation() }
        }
        close(event)
      }

      const handleKeydown = event => {
        if (!event) { return }
        const key = event.key || event.keyCode
        if (key === 'Escape' || key === 'Esc' || key === 27) {
          if (typeof event.preventDefault === 'function') { event.preventDefault() }
          close(event)
        }
      }

      let keydownListener = null

      onMounted(() => {
        hasClosed.value = false
        runLua('extensions.load("ui_topBar_vehiclePartsPainting")')
        runLua('extensions.load("freeroam_vehiclePartsPainting")')
        runLua('freeroam_vehiclePartsPainting.open()')
        runLua('ui_topBar.setActiveItem("vehiclePartsPainting")')

        keydownListener = event => handleKeydown(event)
        if (typeof window !== 'undefined') {
          window.addEventListener('keydown', keydownListener)
        }

        nextTick(() => {
          const targetDialog = dialog.value
          if (targetDialog && typeof targetDialog.focus === 'function') {
            try { targetDialog.focus() } catch (err) {
              if (typeof console !== 'undefined' && console.debug) {
                console.debug('VehiclePartsPainting: unable to focus dialog container.', err)
              }
            }
          }

          const targetClose = closeButton.value
          if (targetClose && typeof targetClose.focus === 'function') {
            try { targetClose.focus() } catch (err) {
              if (typeof console !== 'undefined' && console.debug) {
                console.debug('VehiclePartsPainting: unable to focus close button.', err)
              }
            }
          }
        })
      })

      onBeforeUnmount(() => {
        if (typeof window !== 'undefined' && keydownListener) {
          window.removeEventListener('keydown', keydownListener)
        }
        runLua('freeroam_vehiclePartsPainting.close()')
        runLua('ui_topBar.setActiveItem("")')
      })

      return {
        dialog,
        closeButton,
        handleDialogClick,
        handleBackdropClick,
        handleKeydown,
        close,
        steps,
      }
    },
    render() {
      const h = window.Vue.h
      return h('div', { class: 'vehicle-parts-painting-modal', tabindex: '-1', onKeydown: this.handleKeydown }, [
        h('div', { class: 'vehicle-parts-painting-modal__backdrop', onClick: this.handleBackdropClick }),
        h('section', {
          ref: 'dialog',
          class: 'vehicle-parts-painting-modal__dialog',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': 'vehiclePartsPaintingInstructionsTitle',
          tabindex: '-1',
          onClick: this.handleDialogClick,
        }, [
          h('header', { class: 'vehicle-parts-painting-modal__header' }, [
            h('h1', { class: 'vehicle-parts-painting-modal__title', id: 'vehiclePartsPaintingInstructionsTitle' }, 'Vehicle Parts Painting'),
            h('button', {
              ref: 'closeButton',
              type: 'button',
              class: 'vehicle-parts-painting-modal__dismiss',
              'aria-label': 'Close instructions',
              onClick: this.close,
            }, [h('span', { 'aria-hidden': 'true' }, '\u00d7')]),
          ]),
          h('p', { class: 'vehicle-parts-painting-modal__intro' }, 'Go to the UI Apps menu, search for Vehicle Parts Painting app, add it, position it and resize it as you like, and finally save your layout.'),
          h('h2', { class: 'vehicle-parts-painting-modal__section-title' }, 'Usage'),
          h('ol', { class: 'vehicle-parts-painting-modal__steps' }, this.steps.map(text => h('li', text))),
          h('footer', { class: 'vehicle-parts-painting-modal__actions' }, [
            h('button', { type: 'button', class: 'vehicle-parts-painting-modal__action', onClick: this.close }, 'Close'),
          ]),
        ]),
      ])
    },
  })
}

function registerVueRoute() {
  if (typeof window === 'undefined' || !window.Vue) { return false }
  const router = getRouter()
  if (!router || typeof router.addRoute !== 'function') { return false }

  if (routerHasRoute(router, ROUTE_NAME)) { return true }

  ensureStylesInjected()

  const component = createInstructionsComponent(window.Vue)
  try {
    router.addRoute({
      path: ROUTE_PATH,
      name: ROUTE_NAME,
      component,
      meta: {
        infoBar: { withAngular: true },
        uiApps: { shown: true },
        topBar: { visible: true },
      },
    })
    return true
  } catch (err) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('VehiclePartsPainting: failed to register Vue route.', err)
    }
    return false
  }
}

function scheduleVueRouteRegistration() {
  if (typeof window === 'undefined') { return }
  if (window.__vehiclePartsPaintingRouteScheduled) { return }
  window.__vehiclePartsPaintingRouteScheduled = true

  const maxAttempts = 120
  let attempt = 0

  const tryRegister = () => {
    attempt += 1
    if (registerVueRoute()) { return }
    if (attempt >= maxAttempts) { return }
    window.setTimeout(tryRegister, 500)
  }

  tryRegister()
}

ensureAngularModule()
scheduleVueRouteRegistration()

export default MODULE_NAME
