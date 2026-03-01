import { defineMiddlewares } from "@medusajs/framework/http"

export default defineMiddlewares({
  routes: [
    {
      matcher: "/webhooks/shipbubble",
      methods: ["POST"],
      bodyParser: {
        preserveRawBody: true,
      },
    },
  ],
})
