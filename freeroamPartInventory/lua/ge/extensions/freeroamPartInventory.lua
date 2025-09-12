-- Minimal part inventory for Freeroam mode.
-- Parts can be removed from vehicles and later reinstalled on vehicles of the same model.
--
-- This tries to mimic the behaviour of the career mode inventory. When the
-- vehicle configuration menu is opened the current part configuration is
-- stored. Once the player applies changes and closes the menu we compare the
-- new configuration and store all parts that disappeared.

local M = {}

local partInventory = {}
local nextId = 1

local partsBefore
local monitoringConfig

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
end

-- Opens the vehicle configuration UI and begin monitoring for removed parts
local function openVehicleConfig()
  local veh = be:getPlayerVehicle(0)
  if not veh then return end

  local vehId = veh:getID()
  local vehicleData = extensions.core_vehicle_manager.getVehicleData(vehId)
  partsBefore = vehicleData and vehicleData.config and vehicleData.config.parts or {}
  monitoringConfig = true

  guihooks.trigger('ChangeState', {state = 'vehicleconfig'})
end

-- Called from the UI when the vehicle configuration menu is closed. The
-- provided json string is the applied configuration.
local function applyConfigChanges(configJson)
  if not monitoringConfig then return end

  local veh = be:getPlayerVehicle(0)
  if not veh then return end

  local newParts = jsonDecode(configJson).parts
  for slot, oldPart in pairs(partsBefore or {}) do
    local newPart = newParts[slot]
    if oldPart ~= '' and (newPart == '' or newPart ~= oldPart) then
      storePart(slot, oldPart, veh)
    end
  end

  monitoringConfig = nil
  partsBefore = nil
  sendUIData()
end

M.sendUIData = sendUIData
M.removePart = removePart
M.installPart = installPart
M.openVehicleConfig = openVehicleConfig
M.applyConfigChanges = applyConfigChanges
M.onVehicleConfigSaved = applyConfigChanges

return M

