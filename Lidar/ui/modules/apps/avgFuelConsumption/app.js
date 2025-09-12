angular.module('beamng.apps')
.directive('avgFuelConsumption', [function () {
  return {
    templateUrl: '/ui/modules/apps/avgFuelConsumption/app.html',
    replace: true,
    restrict: 'EA',
    scope: true,
    controller: ['$log', '$scope', function ($log, $scope) {
      // Define the list of streams...
      var streamsList = ['electrics', 'engineInfo'];
      // ...and add them to the Stream-Manager.
      StreamsManager.add(streamsList);
	  
      // Make sure to remove the streams when this app is closed.
      $scope.$on('$destroy', function () {
        StreamsManager.remove(streamsList);
      });
      
      // Preset the data outputs.
      $scope.data1 = '';
      $scope.data2 = '';
      $scope.data3 = '';
      $scope.data4 = '';
      
      // Debug-Text.
      //$scope.debugtext1 = '';
      //$scope.debugtext2 = '';

      // Initialize our data (with remembering the current fuel level).
	  var distanceTravelled = 0,
          fuelUsed = 0,
          avgFuelConsumption = 0,
          range = 0,
          fuelLevelLastReset = 0, // We set it to zero, but below I'll take this into account!
          autoResetOk = false,
		  lastWheelSpeed = 0,
          timer = 0,
          prevTime = performance.now(),
          curTime = prevTime;
      var lastFuelCapacity;
      
      // Reset function.
      $scope.reset = function ($event) {
        $log.debug('<avg-fuel-consumption> resetting avg. fuel consumption');
      
        // Reset our data and remember our current fuel level!
        fuelUsed = 0;
        avgFuelConsumption = 0;
        range = 0;
        fuelLevelLastReset = 0; // We set it to zero, but below I'll take this into account!
        autoResetOk = false;
		
        timer = 0;
        prevTime = performance.now();
        curTime = prevTime;
      };
	  
      $scope.$on('VehicleFocusChanged', function (event, data) {
        $scope.reset()
      })
      
      $scope.$on('streamsUpdate', function (event, streams) {
        $scope.$evalAsync(function () {
          if (!streams.engineInfo || !streams.electrics) { return }
          
          // Retrieve the wheel speed and the current fuel level.
		  var wheelSpeed = streams.electrics.wheelspeed;
          var currentFuel = streams.engineInfo[11];
          var fuelCapacity = streams.engineInfo[12];
			
          // Calculate the travelled distance.
          prevTime = curTime;
          curTime = performance.now();
          timer -= 0.001 * (curTime - prevTime);
          if (timer < 0)
          {
            // Filtering out the background noise.
            if (true
			    && (wheelSpeed > 0.2)
			    && (wheelSpeed != lastWheelSpeed)
			   )
            { distanceTravelled += ((1.0 - timer) * wheelSpeed); }
            timer = 1;
          }
		  lastWheelSpeed = wheelSpeed;
          
          // Remembering the fuel level in the reset function didn't work.
          // So there we set it to zero and here we set it to the current level.
          if (true
              && (fuelLevelLastReset == 0)
              && (currentFuel         > 0)
             )
          {
            $log.debug('<avg-fuel-consumption> resetting: reset level is zero!');
            distanceTravelled = 0;
            fuelLevelLastReset = currentFuel;
			lastFuelCapacity = fuelCapacity;
          }
          // If, out of pure magic, the fuel level suddenly is higher than my remembered level,
          // then HE/SHE/IT must have resetted the whole car ==> let's just reset some values then!
          if (true
              && autoResetOk
              && (false
                  || (currentFuel >= fuelLevelLastReset)
                  || (fuelCapacity != lastFuelCapacity) // capacity changes --> car change!
                 )
             )
          {
            $log.debug('<avg-fuel-consumption> resetting: Fuel level higher than reset level!');
            distanceTravelled = 0;
            fuelLevelLastReset = currentFuel;
            lastFuelCapacity = fuelCapacity;
            autoResetOk = false; // Allowing this only once, in case the engine was switched off!
          }
          // Allow above automatic resetting, when the fuel level goes below the remembered level.
          // Or when the travelled distance goes above zero!
          if (true
              && !autoResetOk
              && (false
                  || (currentFuel < fuelLevelLastReset)
                  || (distanceTravelled > 0)
                 )
             )
          { autoResetOk = true; }
          // Calculate the currently used fuel.
          fuelUsed = fuelLevelLastReset - currentFuel;
          
          // Calculate the average fuel consumption rate according to used fuel vs. travelled distance.
          { avgFuelConsumption = 0; }
          if (distanceTravelled > 0)
          {
            avgFuelConsumption = fuelUsed / distanceTravelled; // l/(s*(m/s)) = l/m
          }
          else
          { avgFuelConsumption = 0; }
          
          // Calculate the range according to the above fuel consumption rate.
          if (avgFuelConsumption > 0)
          { range = UiUnits.buildString('distance', currentFuel / avgFuelConsumption, 2); }
          else
          {
            if (streams.electrics.wheelspeed > 0.1)
            { range = 'Infinity'; }
            else
            { range = UiUnits.buildString('distance', 0); }
          }
          
          // Output of calculated data.
          $scope.data1 = UiUnits.buildString('distance', distanceTravelled, 1);
          $scope.data2 = UiUnits.buildString('volume', fuelUsed, 2)
                       + '/'
                       + UiUnits.buildString('volume', currentFuel, 2)
                       + '/'
                       + UiUnits.buildString('volume', fuelCapacity, 1);
          $scope.data3 = UiUnits.buildString('consumptionRate', avgFuelConsumption, 1);
          $scope.data4 = range;
          
          // Debug-Text.
		  //$scope.debugtext1 = UiUnits.buildString('distance', totalDistance, 1);
		  //$scope.debugtext2 = timer.toFixed(6);
        });
      });
    }]
  };
}]);
