import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  
  return {
    shop: session?.shop || null,
    accessToken: session?.accessToken || null,
    scope: session?.scope || null,
  };
};

export default function DebugToken() {
  const { shop, accessToken, scope } = useLoaderData();
  
  return (
    <s-page heading="Debug Token">
      <s-section heading="Información de Sesión">
        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <s-stack direction="block" gap="tight">
            <s-text variant="headingMd">Shop: {shop || "No disponible"}</s-text>
            <s-text variant="bodyMd">Access Token: {accessToken ? `${accessToken.substring(0, 30)}...` : "No disponible"}</s-text>
            <s-text variant="bodyMd">Scope: {scope || "No disponible"}</s-text>
          </s-stack>
        </s-box>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
