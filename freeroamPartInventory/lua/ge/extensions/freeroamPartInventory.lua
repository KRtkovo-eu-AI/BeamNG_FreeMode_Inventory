-- Minimal part inventory for Freeroam mode.
-- Parts can be removed from vehicles and later reinstalled on vehicles of the same model.
--
-- This provides a very small subset of the career mode part inventory. A simple
-- UI lists the currently installed parts so the player can remove them. Removed
-- parts are stored with basic colour information and can later be installed on
-- vehicles of the same model.

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

-- Sends a list of all parts currently installed on the player's vehicle
local function sendVehicleParts()
  local veh = be:getPlayerVehicle(0)
  if not veh then return end

  local vehId = veh:getID()
  local vehicleData = extensions.core_vehicle_manager.getVehicleData(vehId)
  local list = {}
  if vehicleData and vehicleData.config and vehicleData.config.parts then
    for slot, part in pairs(vehicleData.config.parts) do
      list[#list + 1] = {slot = slot, name = part}
    end
  end
  guihooks.trigger('freeroamPartInventoryVehicleParts', {parts = list})
end

-- Internal helper to store information about a removed part
local function storePart(slot, partName, veh)
  if not veh then return end

  -- store simple colour information; BeamNG exposes vehicle colour so we
  -- capture it for reapplication later. Per-part paint is outside the scope
  -- of this minimal example.
  local color = {veh:getColorRGB()}

  partInventory[nextId] = {
    name = partName,
    slot = slot,
    vehicleModel = veh.jbeam or veh:getJBeamFilename(),
    color = color,
  }

  nextId = nextId + 1
end

-- Removes a part from the player's vehicle by clearing the slot
local function removePart(slot)
  local veh = be:getPlayerVehicle(0)
  if not veh then return end

  local vehId = veh:getID()
  local vehicleData = extensions.core_vehicle_manager.getVehicleData(vehId)
  if not vehicleData or not vehicleData.config or not vehicleData.config.parts then return end

  local partName = vehicleData.config.parts[slot]
  if not partName or partName == '' then return end

  storePart(slot, partName, veh)

  vehicleData.config.parts[slot] = ''
  core_vehicle_manager.queueAdditionalVehicleData({spawnWithEngineRunning = false}, vehId)
  core_vehicles.replaceVehicle(veh.jbeam or veh:getJBeamFilename(), vehicleData, veh)

  sendUIData()
  sendVehicleParts()
end

-- Installs a part from the inventory onto the player's vehicle
local function installPart(id)
  local part = partInventory[id]
  if not part then return end

  local veh = be:getPlayerVehicle(0)
  if not veh then return end

  if (veh.jbeam or veh:getJBeamFilename()) ~= part.vehicleModel then return end

  local vehId = veh:getID()
  local vehicleData = extensions.core_vehicle_manager.getVehicleData(vehId)
  if not vehicleData or not vehicleData.config or not vehicleData.config.parts then return end

  vehicleData.config.parts[part.slot] = part.name
  core_vehicle_manager.queueAdditionalVehicleData({spawnWithEngineRunning = false}, vehId)
  core_vehicles.replaceVehicle(veh.jbeam or veh:getJBeamFilename(), vehicleData, veh)

  if part.color then
    veh:setColorRGB(part.color[1], part.color[2], part.color[3], part.color[4] or 1)
  end

  partInventory[id] = nil
  sendUIData()
  sendVehicleParts()
end

-- Sends current vehicle parts to the UI. Used when the user opens the
-- configuration panel.
local function openVehicleConfig()
  sendVehicleParts()
end

M.sendUIData = sendUIData
M.removePart = removePart
M.installPart = installPart
M.openVehicleConfig = openVehicleConfig

return M

