import router from "@/router"
import routes from "./routes"

routes.forEach(route => router.addRoute(route))
