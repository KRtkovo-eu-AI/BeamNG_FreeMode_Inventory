(function () {
  'use strict'

  angular.module('beamng.apps')
    .config(['$translateProvider', function ($translateProvider) {
      var entries = {
        'vehiclePartsPainting.topbarLabel': 'Parts Painting'
      }

      $translateProvider.translations('en-US', entries)
      $translateProvider.translations('not-shipping.internal', entries)
    }])
})()
