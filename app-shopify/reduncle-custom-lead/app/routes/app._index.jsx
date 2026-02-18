import { useEffect, useState } from "react";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  
  const PROXY_URL = process.env.PROXY_URL || "https://reduncle-custom-lead.onrender.com";
  
  // Si tenemos sesión pero no hay token en el proxy, enviarlo ahora
  if (session?.shop && session?.accessToken) {
    try {
      // Intentar obtener token del proxy primero
      const getResponse = await fetch(`${PROXY_URL}/api/shopify/token/${session.shop}`);
      
      if (!getResponse.ok) {
        // Si no existe, enviarlo ahora
        console.log(`📤 Enviando token al proxy para ${session.shop}...`);
        const postResponse = await fetch(`${PROXY_URL}/api/shopify/token`, {
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
        
        if (postResponse.ok) {
          console.log(`✅ Token enviado al proxy para ${session.shop}`);
        }
      }
    } catch (error) {
      console.error("Error al enviar/obtener token:", error);
    }
  }
  
  // Obtener token del proxy para mostrarlo
  let tokenData = null;
  if (session?.shop) {
    try {
      const response = await fetch(`${PROXY_URL}/api/shopify/token/${session.shop}`);
      if (response.ok) {
        tokenData = await response.json();
      }
    } catch (error) {
      console.error("Error al obtener token:", error);
    }
  }
  
  return { 
    shop: session?.shop || null,
    tokenData,
    PROXY_URL,
    currentAccessToken: session?.accessToken || null, // Token actual de la sesión
  };
};

export default function Index() {
  const { shop, tokenData, PROXY_URL, currentAccessToken } = useLoaderData();
  const [copied, setCopied] = useState(false);

  const copyToken = () => {
    if (tokenData?.accessToken) {
      navigator.clipboard.writeText(tokenData.accessToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <s-page heading="Reduncle Custom Lead">
      <s-section heading="🔑 Token de Acceso Permanente">
        {tokenData ? (
          <s-stack direction="block" gap="base">
            <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
              <s-stack direction="block" gap="tight">
                <s-text variant="headingMd">Tienda: {shop}</s-text>
                <s-text variant="bodyMd">Token recibido: {new Date(tokenData.receivedAt).toLocaleString()}</s-text>
                <s-text variant="bodyMd">Scope: {tokenData.scope || "N/A"}</s-text>
              </s-stack>
            </s-box>
            <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
              <s-stack direction="block" gap="tight">
                <s-text variant="headingMd">Access Token (guardado en proxy):</s-text>
                <s-box padding="base" background="base" borderRadius="base">
                  <s-text variant="bodyMd" fontFamily="mono">
                    {tokenData.accessToken}
                  </s-text>
                </s-box>
                <s-button onClick={copyToken} variant="secondary">
                  {copied ? "✅ Copiado!" : "📋 Copiar Token"}
                </s-button>
              </s-stack>
            </s-box>
          </s-stack>
        ) : currentAccessToken ? (
          <s-stack direction="block" gap="base">
            <s-box padding="base" borderWidth="base" borderRadius="base" background="warning">
              <s-text variant="bodyMd">
              ⚠️ Token no encontrado en proxy, pero tenemos token de sesión actual. Se está enviando automáticamente...
              </s-text>
            </s-box>
            <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
              <s-stack direction="block" gap="tight">
                <s-text variant="headingMd">Token de Sesión Actual:</s-text>
                <s-box padding="base" background="base" borderRadius="base">
                  <s-text variant="bodyMd" fontFamily="mono">
                    {currentAccessToken}
                  </s-text>
                </s-box>
                <s-text variant="bodyMd" tone="subdued">
                  💡 Este token se está enviando al proxy automáticamente. Recarga la página en unos segundos.
                </s-text>
              </s-stack>
            </s-box>
          </s-stack>
        ) : (
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-text variant="bodyMd">
              ⏳ No se ha recibido token aún. El token se enviará automáticamente cuando se instale la app.
            </s-text>
          </s-box>
        )}
      </s-section>

      <s-section heading="🚀 Crear Página Personalizada con IA">
        <s-paragraph>
          Crea páginas personalizadas para tus clientes usando inteligencia artificial. 
          Personaliza el contenido, logo y toda la información según las necesidades de cada cliente.
        </s-paragraph>
        <s-stack direction="block" gap="base">
          <s-button href="/app/create-page" variant="primary" size="large">
            Crear Página con IA
          </s-button>
          <s-button href="/app/admin" variant="secondary" size="large">
            Panel de Administración
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading="¿Cómo funciona?">
        <s-unordered-list>
          <s-list-item>
            Escribe un prompt con toda la información del cliente (nombre, empresa, objetivos, alcance, timeline, equipo, precio)
          </s-list-item>
          <s-list-item>
            Sube un logo o pega el GID de una imagen de Shopify
          </s-list-item>
          <s-list-item>
            La IA personalizará automáticamente toda la página con la información del cliente
          </s-list-item>
          <s-list-item>
            Obtendrás una URL única para cada cliente que podrás compartir
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
