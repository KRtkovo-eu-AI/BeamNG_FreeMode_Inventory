import VehiclePartsPaintingRoute from "./views/VehiclePartsPaintingRoute.vue"

export default [
  {
    path: "/vehicle-parts-painting",
    name: "menu.vehiclePartsPainting",
    component: VehiclePartsPaintingRoute,
    meta: {
      infoBar: {
        withAngular: true,
      },
      uiApps: {
        shown: true,
      },
      topBar: {
        visible: true,
      },
    },
  },
]
