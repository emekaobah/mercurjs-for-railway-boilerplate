
import { defineConfig, loadEnv } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

const stripePaymentProvider =
  process.env.STRIPE_SECRET_API_KEY && process.env.STRIPE_WEBHOOK_SECRET
    ? [
        {
          resolve:
            '@mercurjs/payment-stripe-connect/providers/stripe-connect',
          id: 'stripe-connect',
          options: {
            apiKey: process.env.STRIPE_SECRET_API_KEY,
            webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
          },
        },
      ]
    : []

const virtualPayChannelCode =
  process.env.VIRTUALPAY_CHANNELCODE || process.env.VIRTUALPAY_CHANNEL_CODE

const virtualPayProvider =
  process.env.VIRTUALPAY_SECRET_KEY &&
  process.env.VIRTUALPAY_MERCHANT_ID &&
  virtualPayChannelCode
    ? [
        {
          resolve: './src/modules/payment-providers/virtualpay-retail',
          id: 'retail',
          options: {
            baseUrl:
              process.env.VIRTUALPAY_BASE_URL ||
              'https://developer-sandbox.accessbankplc.com/virtualpay',
            secretKey: process.env.VIRTUALPAY_SECRET_KEY,
            merchantId: process.env.VIRTUALPAY_MERCHANT_ID,
            channelCode: virtualPayChannelCode,
            requestAuthorizer: process.env.VIRTUALPAY_REQUEST_AUTHORIZER || '',
            timeoutMs: process.env.VIRTUALPAY_TIMEOUT_MS || '15000',
            accountDetailsEndpoint:
              process.env.ACCOUNT_DETAILS_ENDPOINT ||
              'https://api-sandbox.accessbankplc.com/AccessBankEnquiryServices/GetAccountDetails',
            accountDetailsChannelCode:
              process.env.ACCOUNT_DETAILS_CHANNEL_CODE || virtualPayChannelCode,
            accountDetailsAuthKey:
              process.env.ACCOUNT_DETAILS_AUTH_KEY ||
              process.env.VIRTUALPAY_SECRET_KEY,
          },
        },
      ]
    : []

const paymentProviders = [...stripePaymentProvider, ...virtualPayProvider]

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    ...(process.env.REDIS_URL ? { redisUrl: process.env.REDIS_URL } : {}),
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      // @ts-expect-error: vendorCors is not a valid config
      vendorCors: process.env.VENDOR_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET || 'supersecret',
      cookieSecret: process.env.COOKIE_SECRET || 'supersecret'
    }
  },
  admin: {
    disable: true,
  },
  plugins: [
    {
      resolve: '@mercurjs/b2c-core',
      options: {}
    },
    {
      resolve: '@mercurjs/commission',
      options: {}
    },
    ...(process.env.ALGOLIA_API_KEY && process.env.ALGOLIA_APP_ID ? [{
      resolve: '@mercurjs/algolia',
      options: {
        apiKey: process.env.ALGOLIA_API_KEY,
        appId: process.env.ALGOLIA_APP_ID
      }
    }] : []),
    {
      resolve: '@mercurjs/reviews',
      options: {}
    },
    {
      resolve: '@mercurjs/requests',
      options: {}
    },
    {
      resolve: '@mercurjs/resend',
      options: {}
    }
  ],
  modules: [
    {
      resolve: '@medusajs/medusa/file',
      options: {
        providers: [
          ...(process.env.MINIO_ENDPOINT && process.env.MINIO_ACCESS_KEY && process.env.MINIO_SECRET_KEY ? [{
            resolve: './src/modules/minio-file',
            id: 'minio',
            options: {
              endPoint: process.env.MINIO_ENDPOINT,
              accessKey: process.env.MINIO_ACCESS_KEY,
              secretKey: process.env.MINIO_SECRET_KEY,
              bucket: process.env.MINIO_BUCKET // Optional, defaults to 'medusa-media'
            }
          }] : [{
            resolve: '@medusajs/medusa/file-local',
            id: 'local',
            options: {
              upload_dir: 'static',
              backend_url: `${process.env.BACKEND_URL || 'http://localhost:9000'}/static`
            }
          }])
        ]
      }
    },
    ...(process.env.REDIS_URL ? [
      {
        resolve: '@medusajs/medusa/event-bus-redis',
        options: {
          redisUrl: process.env.REDIS_URL
        }
      },
      {
        resolve: '@medusajs/medusa/workflow-engine-redis',
        options: {
          redis: {
            url: process.env.REDIS_URL
          }
        }
      }
    ] : []),
    ...(paymentProviders.length ? [{
      resolve: '@medusajs/medusa/payment',
      options: {
        providers: paymentProviders
      }
    }] : []),
    {
      resolve: '@medusajs/medusa/fulfillment',
      options: {
        providers: [
          {
            resolve: '@medusajs/medusa/fulfillment-manual',
            id: 'manual',
          },
          {
            resolve: './src/modules/shipbubble',
            id: 'shipbubble',
            options: {
              enabled: process.env.SHIPBUBBLE_ENABLED || 'false',
              api_base_url:
                process.env.SHIPBUBBLE_API_BASE_URL ||
                'https://api.shipbubble.com',
              api_key: process.env.SHIPBUBBLE_API_KEY || '',
              timeout_ms: process.env.SHIPBUBBLE_TIMEOUT_MS || '15000',
              default_category_id:
                process.env.SHIPBUBBLE_DEFAULT_CATEGORY_ID || '1',
              default_sender_name:
                process.env.SHIPBUBBLE_DEFAULT_SENDER_NAME || 'Store Sender',
              default_sender_email:
                process.env.SHIPBUBBLE_DEFAULT_SENDER_EMAIL || 'sender@example.com',
              default_sender_phone:
                process.env.SHIPBUBBLE_DEFAULT_SENDER_PHONE || '+2348000000000',
              default_receiver_name:
                process.env.SHIPBUBBLE_DEFAULT_RECEIVER_NAME || 'Checkout Customer',
              default_receiver_email:
                process.env.SHIPBUBBLE_DEFAULT_RECEIVER_EMAIL || 'customer@example.com',
              default_receiver_phone:
                process.env.SHIPBUBBLE_DEFAULT_RECEIVER_PHONE || '+2348000000000',
              override_sender_address:
                process.env.SHIPBUBBLE_OVERRIDE_SENDER_ADDRESS || '',
              override_sender_latitude:
                process.env.SHIPBUBBLE_OVERRIDE_SENDER_LATITUDE || '',
              override_sender_longitude:
                process.env.SHIPBUBBLE_OVERRIDE_SENDER_LONGITUDE || '',
              override_receiver_address:
                process.env.SHIPBUBBLE_OVERRIDE_RECEIVER_ADDRESS || '',
              override_receiver_latitude:
                process.env.SHIPBUBBLE_OVERRIDE_RECEIVER_LATITUDE || '',
              override_receiver_longitude:
                process.env.SHIPBUBBLE_OVERRIDE_RECEIVER_LONGITUDE || '',
              default_weight_kg:
                process.env.SHIPBUBBLE_DEFAULT_WEIGHT_KG || '1',
              default_length_cm:
                process.env.SHIPBUBBLE_DEFAULT_LENGTH_CM || '20',
              default_width_cm:
                process.env.SHIPBUBBLE_DEFAULT_WIDTH_CM || '20',
              default_height_cm:
                process.env.SHIPBUBBLE_DEFAULT_HEIGHT_CM || '10',
              checkout_strategy:
                process.env.SHIPBUBBLE_CHECKOUT_STRATEGY || 'best_value',
            },
          },
        ],
      },
    },
    {
      resolve: '@medusajs/medusa/notification',
      options: {
        providers: [
          ...(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL ? [{
            resolve: '@mercurjs/resend/providers/resend',
            id: 'resend',
            options: {
              channels: ['email'],
              api_key: process.env.RESEND_API_KEY,
              from: process.env.RESEND_FROM_EMAIL
            }
          }] : []),
          {
            resolve: '@medusajs/medusa/notification-local',
            id: 'local',
            options: {
              channels: ['feed', 'seller_feed']
            }
          }
        ]
      }
    }
  ]
})
