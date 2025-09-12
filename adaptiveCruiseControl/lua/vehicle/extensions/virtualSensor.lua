-- Simple virtual sensor using a forward raycast to measure distance to obstacles.
-- This is a minimal helper for the adaptive cruise control example.

local M = {}

-- Returns distance in meters to the closest obstacle in front of the vehicle,
-- or nil if no obstacle was detected within the given range.
function M.frontObstacleDistance(maxDistance)
  local pos = obj:getPosition()
  local dir = obj:getDirectionVector()
  local target = vec3(pos.x + dir.x * maxDistance, pos.y + dir.y * maxDistance, pos.z + dir.z * maxDistance)
  local hit, distance = obj:castRay(pos, target, true, false)
  if hit then
    return distance
  end
  return nil
end

return M
