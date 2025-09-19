(function () {
  'use strict'

  function resolveBngApi($injector, $window) {
    if ($injector && typeof $injector.has === 'function' && $injector.has('bngApi')) {
      try {
        var service = $injector.get('bngApi')
        if (service) { return service }
      } catch (err) {
        if (typeof $window !== 'undefined' && $window.console && typeof $window.console.warn === 'function') {
          $window.console.warn('VehiclePartsPainting menu: unable to resolve Angular bngApi service.', err)
        }
      }
    }

    if ($window && $window.bngApi) { return $window.bngApi }
    return null
  }

  function runLua(api, code) {
    if (!api || typeof api.engineLua !== 'function' || !code) { return }
    try {
      api.engineLua(code)
    } catch (err) {
      if (typeof window !== 'undefined' && window.console && typeof window.console.warn === 'function') {
        window.console.warn('VehiclePartsPainting menu: failed to run Lua command.', code, err)
      }
    }
  }

  angular.module('BeamNG.ui')
    .run(['$injector', '$window', function ($injector, $window) {
      var api = resolveBngApi($injector, $window)
      if (!api) { return }
      runLua(api, 'extensions.load("ui_topBar_vehiclePartsPainting")')
    }])
    .config(['$stateProvider', function ($stateProvider) {
      $stateProvider.state('menu.vehiclePartsPainting', {
        url: '/vehicle-parts-painting',
        template: '<vehicle-parts-painting ui-sref-opts="{ inherit: true }"></vehicle-parts-painting>',
        controller: angular.noop,
        uiAppsShown: true,
        backState: 'BACK_TO_MENU',
        onEnter: ['$injector', '$window', function ($injector, $window) {
          var api = resolveBngApi($injector, $window)
          var consoleRef = ($window && $window.console) || (typeof console !== 'undefined' ? console : null)
          var logWarn = function (message, err) {
            if (!consoleRef || typeof consoleRef.warn !== 'function') { return }
            if (err) {
              consoleRef.warn(message, err)
              return
            }
            consoleRef.warn(message)
          }

          if (api) {
            runLua(api, 'extensions.load("ui_topBar_vehiclePartsPainting")')
            runLua(api, 'extensions.load("freeroam_vehiclePartsPainting")')
            runLua(api, 'ui_topBar.setActiveItem("vehiclePartsPainting")')
          }

          if (!$injector || typeof $injector.get !== 'function') {
            logWarn('VehiclePartsPainting menu: Angular injector unavailable; cannot open UI Apps selector.')
            return
          }

          var resolveDependency = function (token) {
            if (typeof $injector.has === 'function') {
              try {
                if (!$injector.has(token)) {
                  logWarn('VehiclePartsPainting menu: dependency "' + token + '" not available.')
                  return null
                }
              } catch (err) {
                logWarn('VehiclePartsPainting menu: unable to check dependency "' + token + '".', err)
              }
            }

            try {
              return $injector.get(token)
            } catch (err) {
              logWarn('VehiclePartsPainting menu: failed to resolve dependency "' + token + '".', err)
              return null
            }
          }

          var stateService = resolveDependency('$state')
          var timeoutService = resolveDependency('$timeout')
          var filtersService = resolveDependency('AppSelectFilters')

          if (filtersService && typeof filtersService === 'object') {
            filtersService.query = 'Vehicle Parts Painting'
          } else if (!filtersService) {
            // already warned during resolution
          } else {
            logWarn('VehiclePartsPainting menu: AppSelectFilters service did not provide an object to update.')
          }

          if (!timeoutService || typeof timeoutService !== 'function') {
            logWarn('VehiclePartsPainting menu: $timeout service unavailable; cannot navigate to UI Apps selector.')
            return
          }

          if (!stateService || typeof stateService.go !== 'function') {
            logWarn('VehiclePartsPainting menu: $state service unavailable; cannot navigate to UI Apps selector.')
            return
          }

          timeoutService(function () {
            try {
              stateService.go('menu.appselect', {}, { inherit: false, location: 'replace' })
            } catch (err) {
              logWarn('VehiclePartsPainting menu: failed to navigate to UI Apps selector.', err)
            }
          }, 0)
        }],
        onExit: angular.noop
      })
    }])
})()
