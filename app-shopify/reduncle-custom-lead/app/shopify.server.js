import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: false, // Cambiar a false para tokens permanentes no caducables
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
  hooks: {
    afterAuth: async ({ session }) => {
      // Este hook se ejecuta cuando se instala la app
      // Enviar el token permanente al proxy
      const PROXY_URL = process.env.PROXY_URL || "https://reduncle-custom-lead.onrender.com";
      
      try {
        const response = await fetch(`${PROXY_URL}/api/shopify/token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            shop: session.shop,
            accessToken: session.accessToken,
            scope: session.scope || "",
          }),
        });

        if (response.ok) {
          console.log(`✅ Token enviado al proxy para ${session.shop}`);
        } else {
          console.error(`❌ Error al enviar token al proxy: ${response.statusText}`);
        }
      } catch (error) {
        console.error(`❌ Error al enviar token al proxy:`, error);
      }
    },
  },
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
