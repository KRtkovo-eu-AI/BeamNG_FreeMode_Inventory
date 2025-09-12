
local M = {}

-- Returns distance in meters to the closest obstacle in front of the vehicle,
-- or nil if no obstacle was detected within the given range.
function M.frontObstacleDistance(maxDistance)
  local pos = obj:getPosition()
  local dir = obj:getDirectionVector()

  -- offset the ray start slightly forward so we don't hit our own vehicle
  local forwardOffset = 1
  local baseOrigin = vec3(pos.x + dir.x * forwardOffset, pos.y + dir.y * forwardOffset, pos.z)

  -- Cast several rays at different heights so we don't miss low or high obstacles
  local heights = {0.3, 0.8, 1.3}
  local best

  local function cast(origin)
    local target = vec3(origin.x + dir.x * maxDistance, origin.y + dir.y * maxDistance, origin.z + dir.z * maxDistance)

    -- Prefer a dynamic raycast so other vehicles are detected. Fallbacks handle
    -- older builds that only expose static geometry queries.
    if be and be.raycast then
      local hit = be:raycast(origin, target, false, true, false)
      if hit and hit.dist and hit.dist < maxDistance then
        best = best and math.min(best, hit.dist) or hit.dist
        return
      end
    elseif scenetree and scenetree.castRay then
      local hit, _, _, dist = scenetree:castRay(origin, target, 0, obj:getId())
      if hit and dist < maxDistance then
        best = best and math.min(best, dist) or dist
        return
      end
    elseif obj.castRay then
      local hit, dist = obj:castRay(origin, dir, maxDistance)
      if hit then
        best = best and math.min(best, dist) or dist
        return
      end
    end

    if obj.castRayStatic then
      local dist = obj:castRayStatic(origin, dir, maxDistance)
      if dist and dist >= 0 and dist < maxDistance then
        best = best and math.min(best, dist) or dist
      end
    end
  end

  for _, h in ipairs(heights) do
    cast(vec3(baseOrigin.x, baseOrigin.y, baseOrigin.z + h))
  end

  if best then
    return best + forwardOffset
  end
  return nil
end

return M
