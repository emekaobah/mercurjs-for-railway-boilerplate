import { ExecArgs } from '@medusajs/framework/types'
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'
import {
  createCollectionsWorkflow,
  createInventoryLevelsWorkflow,
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  createServiceZonesWorkflow,
  createShippingOptionsWorkflow,
  createStockLocationsWorkflow
} from '@medusajs/medusa/core-flows'
import { SELLER_MODULE } from '@mercurjs/b2c-core/modules/seller'
import {
  createLocationFulfillmentSetAndAssociateWithSellerWorkflow,
  createSellerWorkflow
} from '@mercurjs/b2c-core/workflows'
import { SELLER_SHIPPING_PROFILE_LINK } from '@mercurjs/framework'
import { productsToInsert } from './seed/seed-products'

const NIGERIA = 'ng'

const EBEANO_VENDORS = [
  {
    email: 'vendor@ebeanolekki.com',
    password: 'Password@123',
    memberName: 'Ebeano Lekki',
    storeName: 'Ebeano Lekki',
    stockLocationName: 'Ebeano Lekki Store',
    address: {
      address_1: '2 Admiralty Way',
      city: 'Lekki',
      country_code: NIGERIA,
      province: 'Lagos',
      postal_code: '106104',
      phone: '+2348100000001'
    }
  },
  {
    email: 'vendor@ebeanovi.com',
    password: 'Password@123',
    memberName: 'Ebeano Victoria Island',
    storeName: 'Ebeano VI',
    stockLocationName: 'Ebeano VI Store',
    address: {
      address_1: '52 Ajose Adeogun Street',
      city: 'Victoria Island',
      country_code: NIGERIA,
      province: 'Lagos',
      postal_code: '101241',
      phone: '+2348100000002'
    }
  },
  {
    email: 'vendor@ebeanooniru.com',
    password: 'Password@123',
    memberName: 'Ebeano Oniru',
    storeName: 'Ebeano Oniru',
    stockLocationName: 'Ebeano Oniru Store',
    address: {
      address_1: '18 Adeola Odeku Street, Oniru',
      city: 'Victoria Island',
      country_code: NIGERIA,
      province: 'Lagos',
      postal_code: '101241',
      phone: '+2348100000003'
    }
  },
  {
    email: 'vendor@ebeanosurulere.com',
    password: 'Password@123',
    memberName: 'Ebeano Surulere',
    storeName: 'Ebeano Surulere',
    stockLocationName: 'Ebeano Surulere Store',
    address: {
      address_1: '32 Bode Thomas Street',
      city: 'Surulere',
      country_code: NIGERIA,
      province: 'Lagos',
      postal_code: '101212',
      phone: '+2348100000004'
    }
  }
]

// Convert EUR demo amounts to approximate NGN equivalents (rounded to nearest 500)
function toNGN(eurAmount: number): number {
  return Math.round((eurAmount * 1500) / 500) * 500
}

export default async function seedEbeanoVendors({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const authService = container.resolve(Modules.AUTH)
  const sellerService = container.resolve(SELLER_MODULE)
  const productService = container.resolve(Modules.PRODUCT)
  const inventoryService = container.resolve(Modules.INVENTORY)
  const regionService = container.resolve(Modules.REGION)
  const salesChannelService = container.resolve(Modules.SALES_CHANNEL)
  const fulfillmentService = container.resolve(Modules.FULFILLMENT)

  // Require the Nigeria region and default sales channel to exist
  const [nigeriaRegion] = await regionService.listRegions({
    currency_code: 'ngn'
  })
  if (!nigeriaRegion) {
    throw new Error(
      'Nigeria region (NGN) not found. Run the main seed script first.'
    )
  }

  const [defaultSalesChannel] =
    await salesChannelService.listSalesChannels({
      name: 'Default Sales Channel'
    })
  if (!defaultSalesChannel) {
    throw new Error(
      'Default Sales Channel not found. Run the main seed script first.'
    )
  }

  for (const vendor of EBEANO_VENDORS) {
    logger.info(`Seeding vendor: ${vendor.storeName}...`)

    // Idempotency — reuse existing seller or create a new one
    let seller: { id: string }
    const [existingSeller] = await sellerService.listSellers({
      name: vendor.storeName
    })

    if (existingSeller) {
      logger.info(`  Seller "${vendor.storeName}" already exists, reusing.`)
      seller = existingSeller
    } else {
      // 1. Register auth identity
      const { authIdentity } = await authService.register('emailpass', {
        body: {
          email: vendor.email,
          password: vendor.password
        }
      })

      // 2. Create seller + member
      const { result: createdSeller } = await createSellerWorkflow.run({
        container,
        input: {
          auth_identity_id: authIdentity!.id,
          member: {
            name: vendor.memberName,
            email: vendor.email
          },
          seller: {
            name: vendor.storeName,
            email: vendor.email,
            phone: vendor.address.phone,
            city: vendor.address.city,
            address_line: vendor.address.address_1,
            state: vendor.address.province,
            postal_code: vendor.address.postal_code,
            country_code: vendor.address.country_code
          }
        }
      })
      seller = createdSeller
    }

    // 3–9. Stock location, fulfillment, and shipping — only needed for new sellers
    let stockLocation: { id: string }

    const {
      data: existingSellerLocations
    } = await query.graph({
      entity: 'stock_location',
      fields: ['id', 'name'],
      filters: { name: vendor.stockLocationName }
    })

    if (existingSellerLocations.length > 0) {
      logger.info(`  Stock location already exists, reusing.`)
      stockLocation = existingSellerLocations[0]
    } else {
      // 3. Create stock location with Nigerian address
      const {
        result: [createdLocation]
      } = await createStockLocationsWorkflow(container).run({
        input: {
          locations: [
            {
              name: vendor.stockLocationName,
              address: {
                address_1: vendor.address.address_1,
                city: vendor.address.city,
                country_code: vendor.address.country_code,
                province: vendor.address.province,
                postal_code: vendor.address.postal_code,
                phone: vendor.address.phone
              }
            }
          ]
        }
      })
      stockLocation = createdLocation

      // 4. Link stock location to seller, fulfillment provider, and sales channel
      await link.create([
        {
          [SELLER_MODULE]: { seller_id: seller.id },
          [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id }
        },
        {
          [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
          [Modules.FULFILLMENT]: {
            fulfillment_provider_id: 'manual_manual'
          }
        },
        {
          [Modules.SALES_CHANNEL]: {
            sales_channel_id: defaultSalesChannel.id
          },
          [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id }
        }
      ])

      // 5. Create fulfillment set and associate with seller
      await createLocationFulfillmentSetAndAssociateWithSellerWorkflow.run({
        container,
        input: {
          fulfillment_set_data: {
            name: `${vendor.storeName} Fulfillment Set`,
            type: 'shipping'
          },
          location_id: stockLocation.id,
          seller_id: seller.id
        }
      })

      // 6. Get the created fulfillment set
      const {
        data: [updatedLocation]
      } = await query.graph({
        entity: 'stock_location',
        fields: ['*', 'fulfillment_sets.*'],
        filters: { id: stockLocation.id }
      })

      const fulfillmentSetId = updatedLocation?.fulfillment_sets?.[0]?.id
      if (!fulfillmentSetId) {
        logger.warn(`  No fulfillment set found for ${vendor.storeName}, skipping shipping setup.`)
      } else {
        // 7. Create Nigeria service zone
        await createServiceZonesWorkflow.run({
          container,
          input: {
            data: [
              {
                fulfillment_set_id: fulfillmentSetId,
                name: `${vendor.storeName} Nigeria`,
                geo_zones: [{ type: 'country', country_code: NIGERIA }]
              }
            ]
          }
        })

        const [serviceZone] = await fulfillmentService.listServiceZones({
          fulfillment_set: { id: fulfillmentSetId }
        })

        await link.create({
          [SELLER_MODULE]: { seller_id: seller.id },
          [Modules.FULFILLMENT]: { service_zone_id: serviceZone.id }
        })

        // 8. Get the seller's auto-created shipping profile
        const {
          data: [shippingProfileLink]
        } = await query.graph({
          entity: SELLER_SHIPPING_PROFILE_LINK,
          fields: ['shipping_profile_id'],
          filters: { seller_id: seller.id }
        })

        // 9. Create flat-rate Lagos delivery shipping option in NGN
        const {
          result: [shippingOption]
        } = await createShippingOptionsWorkflow.run({
          container,
          input: [
            {
              name: `${vendor.storeName} Delivery`,
              shipping_profile_id: shippingProfileLink.shipping_profile_id,
              service_zone_id: serviceZone.id,
              provider_id: 'manual_manual',
              type: {
                label: `${vendor.storeName} Delivery`,
                code: vendor.storeName.toLowerCase().replace(/\s+/g, '-'),
                description: 'Lagos delivery'
              },
              rules: [
                { value: 'true', attribute: 'enabled_in_store', operator: 'eq' },
                { attribute: 'is_return', value: 'false', operator: 'eq' }
              ],
              prices: [
                { currency_code: 'ngn', amount: 2000 },
                { amount: 2000, region_id: nigeriaRegion.id }
              ],
              price_type: 'flat',
              data: { id: 'manual-fulfillment' }
            }
          ]
        })

        await link.create({
          [SELLER_MODULE]: { seller_id: seller.id },
          [Modules.FULFILLMENT]: { shipping_option_id: shippingOption.id }
        })
      }
    }

    // 10. Create products with NGN prices assigned to this seller (skip if already seeded)
    const vendorSlug = vendor.storeName.toLowerCase().replace(/\s+/g, '-')
    const [existingProduct] = await productService.listProducts({
      handle: `air-force-1-luxe-unisex-sneakers-${vendorSlug}`
    })

    if (existingProduct) {
      logger.info(`  Products already exist for ${vendor.storeName}, skipping.`)
      logger.info(`  ✓ ${vendor.storeName} seeded (${vendor.email})`)
      continue
    }

    logger.info(`  Seeding products for ${vendor.storeName}...`)

    let categories = await productService.listProductCategories(
      {},
      { select: ['id', 'name'] }
    )
    if (categories.length === 0) {
      logger.info('  No categories found, creating defaults...')
      const { result } = await createProductCategoriesWorkflow(container).run({
        input: {
          product_categories: [
            { name: 'Sneakers', is_active: true },
            { name: 'Sandals', is_active: true },
            { name: 'Boots', is_active: true },
            { name: 'Sport', is_active: true },
            { name: 'Accessories', is_active: true },
            { name: 'Tops', is_active: true }
          ]
        }
      })
      categories = result
    }

    let collections = await productService.listProductCollections(
      {},
      { select: ['id', 'title'] }
    )
    if (collections.length === 0) {
      logger.info('  No collections found, creating defaults...')
      const { result } = await createCollectionsWorkflow(container).run({
        input: {
          collections: [
            { title: 'Luxury' },
            { title: 'Vintage' },
            { title: 'Casual' },
            { title: 'Soho' },
            { title: 'Streetwear' },
            { title: 'Y2K' }
          ]
        }
      })
      collections = result
    }

    const randomCategory = () =>
      categories[Math.floor(Math.random() * categories.length)]
    const randomCollection = () =>
      collections[Math.floor(Math.random() * collections.length)]

    // Transform products: replace EUR prices with NGN and assign to this seller's sales channel
    const ngnProducts = productsToInsert.map((p) => ({
      ...p,
      handle: `${p.handle}-${vendor.storeName.toLowerCase().replace(/\s+/g, '-')}`,
      categories: [{ id: randomCategory().id }],
      collection_id: randomCollection().id,
      sales_channels: [{ id: defaultSalesChannel.id }],
      variants: p.variants.map((v) => ({
        ...v,
        prices: v.prices.map((price) => ({
          currency_code: 'ngn',
          amount: toNGN(price.amount)
        }))
      }))
    }))

    await createProductsWorkflow.run({
      container,
      input: {
        products: ngnProducts,
        additional_data: { seller_id: seller.id }
      }
    })

    // 11. Create inventory levels at this seller's stock location
    const inventoryItems = await inventoryService.listInventoryItems(
      {},
      { select: ['id'] }
    )

    // Only create levels for items that don't already have one at this location
    const existingLevels = await inventoryService.listInventoryLevels({
      location_id: stockLocation.id
    })
    const existingItemIds = new Set(existingLevels.map((l) => l.inventory_item_id))

    const newLevels = inventoryItems
      .filter((item) => !existingItemIds.has(item.id))
      .map((item) => ({
        inventory_item_id: item.id,
        location_id: stockLocation.id,
        stocked_quantity: Math.floor(Math.random() * 50) + 10
      }))

    if (newLevels.length > 0) {
      await createInventoryLevelsWorkflow.run({
        container,
        input: { inventory_levels: newLevels }
      })
    }

    logger.info(`  ✓ ${vendor.storeName} seeded (${vendor.email})`)
  }

  logger.info('✅ Ebeano vendors seeded successfully!')
}
