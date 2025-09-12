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
      $scope.currentVehicleModel = null;
      $scope.showConfig = false;

      // Request initial data from Lua
      bngApi.engineLua('extensions.freeroamPartInventory.sendUIData()');

      // Receive updates from Lua for stored parts
      $scope.$on('freeroamPartInventoryData', function (event, data) {
        $scope.$evalAsync(function () {
          var parts = data.parts || [];
          // Lua may send an empty object instead of an empty array; normalise here
          $scope.inventory = Array.isArray(parts) ? parts : Object.values(parts);
        });
      });

      // Receive list of parts currently installed on the vehicle
      $scope.$on('freeroamPartInventoryVehicleParts', function (event, data) {
        $scope.$evalAsync(function () {
          $scope.vehicleParts = data.parts || [];
          $scope.currentVehicleModel = data.vehicleModel;
        });
      });

      $scope.filteredInventory = function () {
        var inv = Array.isArray($scope.inventory) ? $scope.inventory : Object.values($scope.inventory || {});
        if (!$scope.currentVehicleModel) { return inv; }
        return inv.filter(function (p) {
          return p.vehicleModel === $scope.currentVehicleModel;
        });
      };

      // Install a part on the current vehicle
      $scope.install = function (id) {
        bngApi.engineLua('extensions.freeroamPartInventory.installPart(' + id + ')');
      };

      // Remove a part from the current vehicle
      $scope.remove = function (slot) {
        bngApi.engineLua('extensions.freeroamPartInventory.removePart("' + slot + '")');
      };

      // Toggle the custom vehicle configuration list
      $scope.openConfig = function () {
        $scope.showConfig = !$scope.showConfig;
        if ($scope.showConfig) {
          bngApi.engineLua('extensions.freeroamPartInventory.openVehicleConfig()');
        }
      };
    }]
  };
}]);
