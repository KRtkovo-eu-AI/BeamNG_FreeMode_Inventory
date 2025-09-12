
local M = {}

-- Returns distance in meters to the closest obstacle in front of the vehicle,
-- or nil if no obstacle was detected within the given range.
local function castRays(baseOrigin, dir, maxDistance, offset, widthDir)
  -- Cast several rays at different heights and lateral offsets so we don't miss
  -- low/high or slightly off-center obstacles such as other vehicles or road debris.
  local heights = {0.1, 0.5, 1.0, 1.5}
  local laterals = widthDir and {0, 0.5, -0.5} or {0}
  local best

  local function cast(origin)
    local target = vec3(origin.x + dir.x * maxDistance, origin.y + dir.y * maxDistance, origin.z + dir.z * maxDistance)

    -- Prefer a dynamic raycast so other vehicles are detected. Fallbacks handle
    -- older builds that only expose static geometry queries.
    if be and be.raycast then
      -- enable detection of both static world objects and dynamic vehicles
      local hit = be:raycast(origin, target, false, true, true)
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

  for _, lateral in ipairs(laterals) do
    for _, h in ipairs(heights) do
      local origin = vec3(baseOrigin.x, baseOrigin.y, baseOrigin.z + h)
      if widthDir then
        origin.x = origin.x + widthDir.x * lateral
        origin.y = origin.y + widthDir.y * lateral
        origin.z = origin.z + widthDir.z * lateral
      end
      cast(origin)
    end
  end

  if best then
    return best + offset
  end
  return nil
end

function M.frontObstacleDistance(maxDistance)
  local pos = obj:getPosition()
  local dir = obj:getDirectionVector()
  local sideDir = vec3(-dir.y, dir.x, 0)

  -- offset the ray start ahead so we don't hit our own vehicle while still
  -- detecting close obstacles such as stopped cars
  local forwardOffset = 1.5
  local baseOrigin = vec3(pos.x + dir.x * forwardOffset, pos.y + dir.y * forwardOffset, pos.z)

  local dist = castRays(baseOrigin, dir, maxDistance, forwardOffset, sideDir)
  -- ignore hits very close to the ray origin which are likely our own vehicle
  if dist and dist <= forwardOffset + 0.5 then
    return nil
  end
  return dist
end

-- Returns distance to obstacles on the specified side ("left" or "right") or nil if clear.
function M.sideObstacleDistance(maxDistance, side)
  local pos = obj:getPosition()
  local dir = obj:getDirectionVector()
  local sideDir
  if side == "left" then
    sideDir = vec3(-dir.y, dir.x, 0)
  else
    sideDir = vec3(dir.y, -dir.x, 0)
  end

  -- offset the ray start slightly to the side so we don't hit our own vehicle
  -- widen the offset a bit so the sideways casts begin outside the bodywork
  local sideOffset = 1.5
  local baseOrigin = vec3(pos.x + sideDir.x * sideOffset, pos.y + sideDir.y * sideOffset, pos.z)

  local dist = castRays(baseOrigin, sideDir, maxDistance, sideOffset)
  -- discard hits that originate almost at the vehicle's side, as those are
  -- usually our own bodywork
  if dist and dist <= sideOffset + 0.2 then
    return nil
  end
  return dist
end

return M
