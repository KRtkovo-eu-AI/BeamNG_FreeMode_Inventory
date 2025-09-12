-- Simple virtual sensor using a forward raycast to measure distance to obstacles.
-- This is a minimal helper for the adaptive cruise control example.

local M = {}

-- Returns distance in meters to the closest obstacle in front of the vehicle,
-- or nil if no obstacle was detected within the given range.
function M.frontObstacleDistance(maxDistance)
  local pos = obj:getPosition()
  local dir = obj:getDirectionVector()

  -- offset the ray start slightly forward and above the ground so we don't hit our own vehicle
  local forwardOffset = 1
  local origin = vec3(pos.x + dir.x * forwardOffset, pos.y + dir.y * forwardOffset, pos.z + 0.5)

  -- Some game versions expose `castRay` while others use `castRayStatic`.
  -- Try both to stay compatible and avoid runtime errors.
  if obj.castRay then
    local hit, distance = obj:castRay(origin, dir, maxDistance)
    if hit then
      return distance + forwardOffset
    end
  elseif obj.castRayStatic then
    local distance = obj:castRayStatic(origin, dir, maxDistance)
    if distance and distance >= 0 and distance < maxDistance then
      return distance + forwardOffset
    end
  end

  return nil
end

return M
