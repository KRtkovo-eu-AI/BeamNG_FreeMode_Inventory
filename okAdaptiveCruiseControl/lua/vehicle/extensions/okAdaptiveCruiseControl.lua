-- This Source Code Form is subject to the terms of the bCDDL, v. 1.1.
-- If a copy of the bCDDL was not distributed with this
-- file, You can obtain one at http://beamng.com/bCDDL-1.1.txt

local M = {}
local sensor = require("virtualSensor")

M.hasReachedTargetSpeed = false
M.minimumSpeed = 30 / 3.6

local max = math.max
local min = math.min

local targetAcceleration = 3
local maxDecel = 8 -- m/s^2 maximum deceleration used for emergency stops

local isEnabled = false
local targetSpeed = 100 / 3.6
local rampedTargetSpeed = 0
local adaptiveEnabled = false
local timeGap = 2 -- seconds to keep to the vehicle ahead
local minDistance = 5 -- minimum standstill distance in meters
local sensorRange = 250
local state = {}
local disableOnReset = false
local throttleSmooth = newTemporalSmoothing(200, 200)
local speedPID = newPIDStandard(0.3, 2, 0.0, 0, 1, 1, 1, 0, 1)
--speedPID:setDebug(true)

local function onReset()
  log("D", "okAdaptiveCruiseControl", "Adaptive Cruise Control online")
  if disableOnReset then
    isEnabled = false
    electrics.values.throttleOverride = nil
    electrics.values.brakeOverride = nil
  end
  M.hasReachedTargetSpeed = false
  state = {}
  throttleSmooth:reset()
  speedPID:reset()
end

local function updateGFX(dt)
  if not isEnabled then
    return
  end

  --check for post crash brake triggered
  if electrics.values.postCrashBrakeTriggered then
    M.setEnabled(false)
    return
  end

  if input.brake > 0 then
    --disable cruise control when braking
    M.setEnabled(false)
    return
  end

  if input.clutch > 0 or input.throttle > 0 then
    --dont't do anything if we use the clutch or if we manually input a throttle value

    electrics.values.throttleOverride = input.throttle
    return
  end

  local currentSpeed = electrics.values.wheelspeed or 0
  local desiredSpeed = targetSpeed
  if adaptiveEnabled then
    local dist = sensor.frontObstacleDistance(sensorRange)
    if dist then
      local brakeDist = currentSpeed * currentSpeed / (2 * maxDecel)
      if dist - minDistance <= brakeDist then
        desiredSpeed = 0
      else
        local followSpeed = (dist - minDistance) / timeGap
        desiredSpeed = min(desiredSpeed, max(0, followSpeed))
      end
    end
  end

  --ramp up/down our target speed with our desired target acceleration to avoid integral wind-up
  if rampedTargetSpeed ~= desiredSpeed then
    local upperLimit = desiredSpeed > rampedTargetSpeed and desiredSpeed or rampedTargetSpeed
    local lowerLimit = desiredSpeed < rampedTargetSpeed and desiredSpeed or rampedTargetSpeed
    rampedTargetSpeed = clamp(rampedTargetSpeed + sign(desiredSpeed - rampedTargetSpeed) * targetAcceleration * dt, lowerLimit, upperLimit)
  end

  local output = speedPID:get(currentSpeed, rampedTargetSpeed, dt)
  if output >= 0 then
    electrics.values.throttleOverride = throttleSmooth:getUncapped(output, dt)
    electrics.values.brakeOverride = nil
  else
    electrics.values.throttleOverride = 0
    electrics.values.brakeOverride = -output
  end

  local currentError = currentSpeed - desiredSpeed
  local denom = desiredSpeed ~= 0 and desiredSpeed or 1
  M.hasReachedTargetSpeed = math.abs(currentError) / denom <= 0.03
end

local function setSpeed(speed)
  isEnabled = true
  targetSpeed = max(speed, M.minimumSpeed)
  rampedTargetSpeed = electrics.values.wheelspeed or 0
  M.hasReachedTargetSpeed = false
  speedPID:reset()
  M.requestState()
end

local function changeSpeed(offset)
  isEnabled = true
  targetSpeed = max(targetSpeed + offset, M.minimumSpeed)
  rampedTargetSpeed = electrics.values.wheelspeed or 0
  M.hasReachedTargetSpeed = false
  speedPID:reset()
  M.requestState()
end

local function holdCurrentSpeed()
  local currentSpeed = electrics.values.wheelspeed or 0
  if currentSpeed > M.minimumSpeed then
    setSpeed(currentSpeed)
  end
  M.requestState()
end

local function setEnabled(enabled)
  isEnabled = enabled
  M.hasReachedTargetSpeed = false
  electrics.values.throttleOverride = nil
  electrics.values.brakeOverride = nil
  rampedTargetSpeed = electrics.values.wheelspeed or 0
  throttleSmooth:reset()
  speedPID:reset()
  M.requestState()
end

local function setTargetAcceleration(target)
  targetAcceleration = target
end

local function requestState()
  state.targetSpeed = targetSpeed
  state.isEnabled = isEnabled
  state.adaptiveEnabled = adaptiveEnabled
  state.timeGap = timeGap

  electrics.values.okAdaptiveCruiseControlTarget = targetSpeed
  electrics.values.okAdaptiveCruiseControlActive = isEnabled

  if not playerInfo.firstPlayerSeated then
    return
  end
  guihooks.trigger("okAdaptiveCruiseControlState", state)
end

local function getConfiguration()
  return {isEnabled = isEnabled, targetSpeed = targetSpeed, minimumSpeed = M.minimumSpeed, hasReachedTargetSpeed = M.hasReachedTargetSpeed, adaptiveEnabled = adaptiveEnabled, timeGap = timeGap}
end

local function setAdaptiveEnabled(enabled)
  adaptiveEnabled = enabled
  M.requestState()
end

local function setTimeGap(gap)
  timeGap = max(0.1, gap)
  M.requestState()
end

-- public interface
M.onReset = onReset
M.updateGFX = updateGFX
M.setSpeed = setSpeed
M.changeSpeed = changeSpeed
M.holdCurrentSpeed = holdCurrentSpeed
M.setEnabled = setEnabled
M.requestState = requestState
M.getConfiguration = getConfiguration
M.setTargetAcceleration = setTargetAcceleration
M.setAdaptiveEnabled = setAdaptiveEnabled
M.setTimeGap = setTimeGap

return M
