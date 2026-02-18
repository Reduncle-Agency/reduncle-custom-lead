import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export default function Index() {

  return (
    <s-page heading="Reduncle Custom Lead">
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
