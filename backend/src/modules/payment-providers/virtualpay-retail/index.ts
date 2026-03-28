import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import VirtualPayRetailProviderService from "./service"

export default ModuleProvider(Modules.PAYMENT, {
  services: [VirtualPayRetailProviderService],
})

