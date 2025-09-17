(function () {
  'use strict';

  const TOPBAR_ITEM_ID = 'vehiclePartsPainting';
  const TOPBAR_TEMPLATE = {
    id: TOPBAR_ITEM_ID,
    label: 'vehiclePartsPainting.topbarLabel',
    icon: 'engine',
    targetState: 'menu.vehiclePartsPainting',
    substate: 'menu.vehiclePartsPainting',
    order: 250,
    flags: ['inGameOnly', 'noMission', 'noScenario', 'noGarage']
  };

  function getBridgeEvents() {
    if (window.bridge && window.bridge.events) {
      return window.bridge.events;
    }
    if (window.bngVue && window.bngVue.$game && window.bngVue.$game.events) {
      return window.bngVue.$game.events;
    }
    return null;
  }

  function ensureTopBarItem(container) {
    if (!container || typeof container !== 'object') { return; }
    if (container[TOPBAR_ITEM_ID]) { return; }
    container[TOPBAR_ITEM_ID] = angular.copy(TOPBAR_TEMPLATE);
  }

  function mutateDataPayload(payload) {
    if (!payload || typeof payload !== 'object') { return; }
    if (payload.items && typeof payload.items === 'object') {
      ensureTopBarItem(payload.items);
    } else {
      ensureTopBarItem(payload);
    }
  }

  function activateTopBar() {
    const topBar = window.bngVue && window.bngVue.topBar;
    if (!topBar) { return; }

    if (typeof topBar.show === 'function') {
      topBar.show();
    }
    if (typeof topBar.selectEntry === 'function') {
      topBar.selectEntry(TOPBAR_ITEM_ID);
    }
    if (typeof topBar.onUIStateChanged === 'function') {
      topBar.onUIStateChanged({ name: 'menu.vehiclePartsPainting', fullPath: '/menu.vehiclePartsPainting' });
    }
  }

  angular.module('beamng.stuff')
    .config(['$stateProvider', function ($stateProvider) {
      $stateProvider.state('menu.vehiclePartsPainting', {
        url: '/vehicle-parts-painting',
        template: '<vehicle-parts-painting ui-sref-opts="{ inherit: true }"></vehicle-parts-painting>',
        controller: 'VehiclePartsPaintingMenuCtrl',
        uiAppsShown: true,
        backState: 'BACK_TO_MENU'
      });
    }])
    .run(['$rootScope', 'bngApi', function ($rootScope, bngApi) {
      if (bngApi && typeof bngApi.engineLua === 'function') {
        bngApi.engineLua('extensions.load("ui_topBar_vehiclePartsPainting")');
      }

      const events = getBridgeEvents();
      if (!events || typeof events.on !== 'function') { return; }

      const onDataRequested = function (payload) {
        mutateDataPayload(payload);
      };
      const onEntriesChanged = function (payload) {
        mutateDataPayload(payload);
      };

      events.on('ui_topBar_dataRequested', onDataRequested);
      events.on('ui_topBar_entriesChanged', onEntriesChanged);

      $rootScope.$on('$destroy', function () {
        if (typeof events.off === 'function') {
          events.off('ui_topBar_dataRequested', onDataRequested);
          events.off('ui_topBar_entriesChanged', onEntriesChanged);
        }
      });
    }])
    .controller('VehiclePartsPaintingMenuCtrl', ['$scope', 'bngApi', function ($scope, bngApi) {
      const events = getBridgeEvents();

      activateTopBar();
      if (events && typeof events.emit === 'function') {
        events.emit('ui_topBar_uiStateChanged', { name: 'menu.vehiclePartsPainting', fullPath: '/menu.vehiclePartsPainting' });
      }

      if (bngApi && typeof bngApi.engineLua === 'function') {
        bngApi.engineLua('extensions.load("freeroam_vehiclePartsPainting")');
        bngApi.engineLua('freeroam_vehiclePartsPainting.onMenuOpened()');
      }

      $scope.$on('$destroy', function () {
        if (bngApi && typeof bngApi.engineLua === 'function') {
          bngApi.engineLua('freeroam_vehiclePartsPainting.onMenuClosed()');
        }
      });
    }]);
})();
