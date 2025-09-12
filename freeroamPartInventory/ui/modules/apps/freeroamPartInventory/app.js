angular.module('beamng.apps')
.directive('freeroamPartInventory', [function () {
  return {
    templateUrl: '/ui/modules/apps/freeroamPartInventory/app.html',
    replace: true,
    restrict: 'EA',
    scope: true,
    controller: ['$scope', function ($scope) {
      $scope.inventory = [];
      $scope.vehicleParts = [];
      $scope.showConfig = false;

      // Request initial data from Lua
      bngApi.engineLua('extensions.freeroamPartInventory.sendUIData()');

      // Receive updates for stored parts
      $scope.$on('freeroamPartInventoryData', function (event, data) {
        $scope.$evalAsync(function () {
          $scope.inventory = data.parts || [];
        });
      });

      // Receive current vehicle parts when entering configuration view
      $scope.$on('freeroamPartInventoryVehicleParts', function (event, data) {
        $scope.$evalAsync(function () {
          $scope.vehicleParts = data.parts || [];
          $scope.showConfig = true;
        });
      });

      // Install a part on the current vehicle
      $scope.install = function (id) {
        bngApi.engineLua('extensions.freeroamPartInventory.installPart(' + id + ')');
      };

      // Remove a part from the current vehicle
      $scope.remove = function (slot) {
        bngApi.engineLua('extensions.freeroamPartInventory.removePart("' + slot + '")');
      };

      // Open vehicle configuration view
      $scope.openConfig = function () {
        bngApi.engineLua('extensions.freeroamPartInventory.openVehicleConfig()');
      };

      // Close configuration view
      $scope.closeConfig = function () {
        $scope.showConfig = false;
      };
    }]
  };
}]);
