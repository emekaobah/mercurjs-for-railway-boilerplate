import { ModuleProviderExports } from "@medusajs/framework/types"
import ShipbubbleFulfillmentProviderService from "./service"

const services = [ShipbubbleFulfillmentProviderService]

const providerExport: ModuleProviderExports = {
  services,
}

export default providerExport
