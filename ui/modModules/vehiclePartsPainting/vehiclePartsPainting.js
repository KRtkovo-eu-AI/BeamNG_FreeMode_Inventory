const MODULE_NAME = 'vehiclePartsPaintingMenu'
const TOPBAR_EXTENSION = 'ui_topBar_vehiclePartsPainting'
const TOPBAR_EXTENSION_ALIAS = 'ui/topBar/vehiclePartsPainting'
const FREEROAM_EXTENSION = 'freeroam_vehiclePartsPainting'
const TOPBAR_ITEM_ID = 'vehiclePartsPainting'

function resolveBngApi($injector, $window) {
  if ($injector && typeof $injector.has === 'function' && $injector.has('bngApi')) {
    try {
      const service = $injector.get('bngApi')
      if (service) { return service }
    } catch (err) {
      if ($window && $window.console && typeof $window.console.warn === 'function') {
        $window.console.warn('VehiclePartsPainting menu: unable to resolve Angular bngApi service.', err)
      }
    }
  }

  if ($window && $window.bngApi) { return $window.bngApi }
  return null
}

function runLua(api, command) {
  if (!api || typeof api.engineLua !== 'function' || !command) { return }
  try {
    api.engineLua(command)
  } catch (err) {
    if (typeof window !== 'undefined' && window.console && typeof window.console.warn === 'function') {
      window.console.warn('VehiclePartsPainting menu: failed to run Lua command.', command, err)
    }
  }
}

function ensureTopBarHelperLoaded(api) {
  const script = `
    local manager = extensions
    if type(manager) ~= 'table' then return end

    local function ensure(name)
      if type(name) ~= 'string' or name == '' then return end
      if type(manager.isExtensionLoaded) == 'function' then
        local okLoaded, loaded = pcall(manager.isExtensionLoaded, name)
        if okLoaded and loaded then return end
      end
      if type(manager.load) == 'function' then
        pcall(manager.load, name)
      end
    end

    ensure('${TOPBAR_EXTENSION}')
    ensure('${TOPBAR_EXTENSION_ALIAS}')
  `

  runLua(api, script)
}

function ensureFreeroamExtensionLoaded(api) {
  const script = `
    local manager = extensions
    if type(manager) ~= 'table' then return end
    if type(manager.isExtensionLoaded) == 'function' then
      local okLoaded, loaded = pcall(manager.isExtensionLoaded, '${FREEROAM_EXTENSION}')
      if okLoaded and loaded then return end
    end
    if type(manager.load) == 'function' then
      pcall(manager.load, '${FREEROAM_EXTENSION}')
    end
  `

  runLua(api, script)
}

function setTopBarActive(api) {
  runLua(api, `ui_topBar.setActiveItem("${TOPBAR_ITEM_ID}")`)
}

angular.module(MODULE_NAME, [])
  .run(['$injector', '$window', function ($injector, $window) {
    const api = resolveBngApi($injector, $window)
    if (!api) { return }
    ensureTopBarHelperLoaded(api)
  }])
  .config(['$stateProvider', function ($stateProvider) {
    $stateProvider.state('menu.vehiclePartsPainting', {
      url: '/vehicle-parts-painting',
      template: '<vehicle-parts-painting ui-sref-opts="{ inherit: true }"></vehicle-parts-painting>',
      controller: angular.noop,
      uiAppsShown: true,
      backState: 'BACK_TO_MENU',
      onEnter: ['$injector', '$window', function ($injector, $window) {
        const api = resolveBngApi($injector, $window)
        if (!api) { return }
        ensureTopBarHelperLoaded(api)
        ensureFreeroamExtensionLoaded(api)
        runLua(api, 'freeroam_vehiclePartsPainting.open()')
        setTopBarActive(api)
      }],
      onExit: ['$injector', '$window', function ($injector, $window) {
        const api = resolveBngApi($injector, $window)
        if (!api) { return }
        runLua(api, 'freeroam_vehiclePartsPainting.close()')
      }]
    })
  }])
