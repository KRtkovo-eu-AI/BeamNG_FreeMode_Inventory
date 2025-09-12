angular.module('beamng.apps')
.directive('freeroamPartInventory', [function () {
  return {
    templateUrl: '/ui/modules/apps/freeroamPartInventory/app.html',
    replace: true,
    restrict: 'EA',
    scope: true,
    controller: ['$scope', function ($scope) {
      $scope.openConfig = function () {
        bngApi.engineLua('extensions.freeroamPartInventory.open()');
      };
    }]
  };
}]);
