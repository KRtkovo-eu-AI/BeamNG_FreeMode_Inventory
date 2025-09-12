angular.module('beamng.apps')
.directive('freeroamPartInventory', [function () {
  return {
    templateUrl: '/ui/modules/apps/freeroamPartInventory/app.html',
    replace: true,
    restrict: 'EA',
    scope: true,
    controller: ['$scope', function ($scope) {
      $scope.inventory = [];

      // Request initial data from Lua
      bngApi.engineLua('extensions.freeroamPartInventory.sendUIData()');

      // Receive updates from Lua
      $scope.$on('freeroamPartInventoryData', function (event, data) {
        $scope.$evalAsync(function () {
          $scope.inventory = data.parts || [];
        });
      });

      // Install a part on the current vehicle
      $scope.install = function (id) {
        bngApi.engineLua('extensions.freeroamPartInventory.installPart(' + id + ')');
      };
    }]
  };
}]);
