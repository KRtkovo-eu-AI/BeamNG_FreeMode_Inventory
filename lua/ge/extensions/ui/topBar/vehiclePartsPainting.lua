-- This Source Code Form is subject to the terms of the bCDDL, v. 1.1.
-- If a copy of the bCDDL was not distributed with this
-- file, You can obtain one at http://beamng.com/bCDDL-1.1.txt

local function loadHelper()
  local ok, module = pcall(require, 'ge.extensions.ui_topBar_vehiclePartsPainting')
  if ok and type(module) == 'table' then
    return module
  end

  local manager = rawget(_G, 'extensions')
  if type(manager) == 'table' then
    local existing = rawget(manager, 'ui_topBar_vehiclePartsPainting')
    if type(existing) == 'table' then
      return existing
    end
  end

  return {}
end

return loadHelper()
