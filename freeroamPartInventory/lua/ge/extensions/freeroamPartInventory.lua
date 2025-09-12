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

local function sendVehicleParts()
  local veh = be:getPlayerVehicle(0)
  if not veh then return end

  local vehId = veh:getID()
  local vehicleData = extensions.core_vehicle_manager.getVehicleData(vehId)
  local list = {}
  -- parts are organised in a tree; flatten it to a simple list for the UI
  local function gather(node)
    if not node then return end
    if node.chosenPartName then
      list[#list + 1] = {slot = node.path, name = node.chosenPartName}
    end
    if node.children then
      for _, child in pairs(node.children) do
        gather(child)
      end
    end
  end
  if vehicleData and vehicleData.config and vehicleData.config.partsTree then
    gather(vehicleData.config.partsTree)
  end
  guihooks.trigger('freeroamPartInventoryVehicleParts', {
    parts = list,
    vehicleModel = veh.jbeam or veh:getJBeamFilename(),
  })
end

-- Internal helper to store information about a removed part
local function storePart(slot, partName, veh)
  if not veh then return end

  local vehId = veh:getID()
  local vehicleData = extensions.core_vehicle_manager.getVehicleData(vehId)

  local color
  if vehicleData and vehicleData.partConditions then
    local cond = vehicleData.partConditions[slot]
    if cond and cond.visualState and cond.visualState.paint then
      color = cond.visualState.paint.originalPaints
    end
  end

  -- fallback to whole-vehicle colour when per-part data is unavailable
  if not color then
    color = {veh:getColorRGB()}
  end

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
    local colorJson = jsonEncode(part.color)
    veh:queueLuaCommand(string.format(
      "partCondition.setPartPaints('%s', jsonDecode('%s'))",
      part.slot,
      colorJson
    ))
  end

  partInventory[id] = nil
  sendUIData()
  sendVehicleParts()
end

-- Sends current vehicle parts to the UI. Used when the user opens the
-- configuration panel.
local function openVehicleConfig()
  sendUIData()
  sendVehicleParts()
end

M.sendUIData = sendUIData
M.removePart = removePart
M.installPart = installPart
M.openVehicleConfig = openVehicleConfig

return M

