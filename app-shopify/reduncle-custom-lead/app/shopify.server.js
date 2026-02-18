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
      console.log(`🚀 afterAuth hook ejecutado para shop: ${session?.shop}`);
      console.log(`🔑 AccessToken presente: ${session?.accessToken ? 'SÍ' : 'NO'}`);
      
      if (!session?.shop || !session?.accessToken) {
        console.error(`❌ afterAuth: Sesión incompleta. Shop: ${session?.shop}, AccessToken: ${session?.accessToken ? 'presente' : 'ausente'}`);
        return;
      }
      
      // Enviar el token permanente al proxy
      const PROXY_URL = process.env.PROXY_URL || "https://reduncle-custom-lead.onrender.com";
      const tokenEndpoint = `${PROXY_URL}/api/shopify/token`;
      
      console.log(`📤 Enviando token al proxy: ${tokenEndpoint}`);
      console.log(`📝 Shop: ${session.shop}`);
      console.log(`📝 Token (primeros 20 chars): ${session.accessToken.substring(0, 20)}...`);
      
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 segundos timeout
        
        const response = await fetch(tokenEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            shop: session.shop,
            accessToken: session.accessToken,
            scope: session.scope || "",
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        
        const responseText = await response.text();
        console.log(`📥 Respuesta del proxy: Status ${response.status}, Body: ${responseText}`);
        
        if (response.ok) {
          console.log(`✅ Token enviado exitosamente al proxy para ${session.shop}`);
        } else {
          console.error(`❌ Error al enviar token al proxy: ${response.status} ${response.statusText}`);
          console.error(`❌ Respuesta: ${responseText}`);
        }
      } catch (error) {
        if (error.name === 'AbortError') {
          console.error(`❌ Timeout al enviar token al proxy (10 segundos)`);
        } else {
          console.error(`❌ Error al enviar token al proxy:`, error);
          console.error(`❌ Stack:`, error.stack);
          console.error(`❌ Message:`, error.message);
        }
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
