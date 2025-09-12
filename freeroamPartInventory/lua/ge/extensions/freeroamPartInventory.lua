-- Minimal part inventory for Freeroam mode.
-- Parts can be removed from vehicles and later reinstalled on vehicles of the same model.

local M = {}

local partInventory = {}
local nextId = 1

-- Sends current inventory to the UI app
local function sendUIData()
  local list = {}
  for id, part in pairs(partInventory) do
    list[#list + 1] = {
      id = id,
      name = part.name,
      slot = part.slot,
      vehicleModel = part.vehicleModel
    }
  end
  guihooks.trigger('freeroamPartInventoryData', {parts = list})
end

-- Stores a part from the player's current vehicle.
-- The slot name must match one from the vehicle's part configuration.
local function storePart(slot)
  local veh = be:getPlayerVehicle(0)
  if not veh then return end

  local config = jsonDecode(veh:getPartConfig())
  local partName = config.parts[slot]
  if not partName or partName == '' then return end

  -- Save part information
  partInventory[nextId] = {
    name = partName,
    slot = slot,
    vehicleModel = veh.jbeam or veh:getJBeamFilename()
  }

  -- Remove part from vehicle by clearing the slot
  config.parts[slot] = ''
  veh:applyPartConfig(config)

  nextId = nextId + 1
  sendUIData()
end

-- Installs a part from the inventory onto the player's vehicle
local function installPart(id)
  local part = partInventory[id]
  if not part then return end

  local veh = be:getPlayerVehicle(0)
  if not veh then return end

  if (veh.jbeam or veh:getJBeamFilename()) ~= part.vehicleModel then return end

  local config = jsonDecode(veh:getPartConfig())
  config.parts[part.slot] = part.name
  veh:applyPartConfig(config)

  partInventory[id] = nil
  sendUIData()
end

M.sendUIData = sendUIData
M.storePart = storePart
M.installPart = installPart

return M
