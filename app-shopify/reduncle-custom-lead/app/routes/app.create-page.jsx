import { useState, useRef } from "react";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  
  const API_BASE_URL = "https://reduncle-custom-lead.onrender.com";
  
  return { API_BASE_URL };
};

export default function CreatePage() {
  const { API_BASE_URL } = useLoaderData();
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [logoGid, setLogoGid] = useState("");
  const [showGidPreview, setShowGidPreview] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const fileInputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFile(file);
    }
  };

  const handleFile = (file) => {
    if (!file.type.startsWith('image/')) {
      alert('Por favor, selecciona una imagen válida (JPG, PNG, SVG, WEBP)');
      return;
    }
    
    if (file.size > 5 * 1024 * 1024) {
      alert('La imagen es demasiado grande. Máximo 5MB');
      return;
    }
    
    setLogoFile(file);
    setLogoGid("");
    setShowGidPreview(false);
    
    const reader = new FileReader();
    reader.onload = (e) => setLogoPreview(e.target.result);
    reader.readAsDataURL(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleGidChange = (e) => {
    const gid = e.target.value.trim();
    setLogoGid(gid);
    setShowGidPreview(gid.length > 0);
    if (gid) {
      setLogoFile(null);
      setLogoPreview(null);
    }
  };

  const removeLogo = () => {
    setLogoFile(null);
    setLogoPreview(null);
    setLogoGid("");
    setShowGidPreview(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const uploadLogo = async () => {
    if (!logoFile) return null;
    
    const formData = new FormData();
    formData.append('logo', logoFile);
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/upload-logo`, {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        throw new Error('Error al subir el logo');
      }
      
      const data = await response.json();
      return data.url;
    } catch (error) {
      console.error('Error al subir logo:', error);
      alert('⚠️ No se pudo subir el logo. La página se creará sin logo.');
      return null;
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!prompt.trim()) {
      alert('Por favor, escribe un prompt con la información del cliente');
      return;
    }
    
    setIsSubmitting(true);
    setResult({ type: 'processing', message: '⏳ Procesando...\nEl servidor está generando tu página personalizada. Esto puede tardar entre 5-15 minutos en el plan gratuito de Render (cold start + procesamiento de IA).\n💡 No cierres esta página. Revisa los logs de Render si quieres ver el progreso.' });
    
    try {
      let finalLogoUrl = null;
      
      if (logoFile) {
        setResult({ type: 'processing', message: '⏳ Subiendo logo...' });
        finalLogoUrl = await uploadLogo();
      } else if (logoGid) {
        finalLogoUrl = logoGid;
      }
      
      setResult({ type: 'processing', message: '⏳ Generando página... (puede tardar 1-3 min)' });
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1200000); // 20 minutos
      
      const response = await fetch(`${API_BASE_URL}/api/create-client`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt: prompt.trim(),
          logoUrl: finalLogoUrl
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Error del servidor (${response.status}): ${errorText}`);
      }
      
      let data;
      try {
        const responseText = await response.text();
        data = JSON.parse(responseText);
      } catch (jsonError) {
        throw new Error('Error al procesar la respuesta del servidor. La página puede haberse creado correctamente. Revisa los logs de Render.');
      }
      
      if (data.success) {
        setResult({
          type: 'success',
          url: data.url,
          message: '✅ ¡Página creada exitosamente!'
        });
      } else {
        throw new Error(data.error || 'Error desconocido');
      }
    } catch (error) {
      console.error('Error:', error);
      let errorMessage = error.message;
      if (error.name === 'AbortError') {
        errorMessage = '⏱️ La solicitud tardó demasiado (más de 20 minutos). El servidor puede estar procesando. Revisa los logs de Render para ver si se creó el cliente.';
      } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        errorMessage = '🌐 Error de conexión. El servidor puede estar iniciando (cold start ~50 segundos). Intenta de nuevo en unos segundos.';
      } else if (error.message.includes('JSON')) {
        errorMessage = '⚠️ Error al procesar la respuesta del servidor. La página puede haberse creado correctamente. Revisa los logs de Render.';
      }
      setResult({
        type: 'error',
        message: `❌ Error: ${errorMessage}\n\n💡 Tip: En el plan gratuito de Render, el servidor puede tardar ~50 segundos en iniciar si estaba inactivo.`
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyUrl = () => {
    if (result?.url) {
      navigator.clipboard.writeText(result.url).then(() => {
        alert('URL copiada al portapapeles!');
      });
    }
  };

  return (
    <s-page heading="Crear Página Personalizada con IA">
      <style>{`
        .create-page-container {
          max-width: 900px;
          margin: 0 auto;
          background: white;
          border-radius: 12px;
          padding: 40px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.1);
        }
        .form-group {
          margin-bottom: 30px;
        }
        .form-label {
          display: block;
          margin-bottom: 12px;
          font-weight: 600;
          font-size: 18px;
          color: #333;
        }
        .logo-preview-container {
          margin-bottom: 15px;
          padding: 15px;
          background: #f0f0f0;
          border-radius: 8px;
        }
        .logo-preview-container img {
          max-width: 200px;
          max-height: 100px;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        .logo-dropzone {
          border: 2px dashed #ddd;
          border-radius: 8px;
          padding: 40px;
          text-align: center;
          cursor: pointer;
          background: #f9f9f9;
          transition: all 0.3s;
        }
        .logo-dropzone:hover,
        .logo-dropzone.dragging {
          border-color: #ff0000;
          background: #fff5f5;
        }
        .logo-preview-img {
          max-width: 200px;
          max-height: 100px;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          margin-bottom: 10px;
        }
        .remove-logo-btn {
          margin-top: 10px;
          padding: 5px 15px;
          background: #dc3545;
          color: white;
          border: none;
          border-radius: 5px;
          cursor: pointer;
          font-size: 12px;
        }
        .remove-logo-btn:hover {
          background: #c82333;
        }
        .gid-input {
          width: 100%;
          padding: 12px;
          border: 2px solid #ddd;
          border-radius: 8px;
          font-size: 14px;
          font-family: monospace;
        }
        .gid-input:focus {
          outline: none;
          border-color: #ff0000;
        }
        .prompt-textarea {
          width: 100%;
          padding: 16px;
          border: 2px solid #ddd;
          border-radius: 8px;
          font-family: inherit;
          font-size: 15px;
          line-height: 1.6;
          resize: vertical;
          min-height: 200px;
        }
        .prompt-textarea:focus {
          outline: none;
          border-color: #ff0000;
        }
        .submit-btn {
          width: 100%;
          padding: 16px;
          background: #ff0000;
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.3s;
        }
        .submit-btn:hover:not(:disabled) {
          background: #cc0000;
        }
        .submit-btn:disabled {
          background: #999;
          cursor: not-allowed;
        }
        .result {
          margin-top: 20px;
          padding: 15px;
          border-radius: 8px;
          white-space: pre-line;
        }
        .result.processing {
          background: #fff3cd;
          color: #856404;
          border: 1px solid #ffc107;
        }
        .result.success {
          background: #d4edda;
          color: #155724;
          border: 1px solid #c3e6cb;
        }
        .result.error {
          background: #f8d7da;
          color: #721c24;
          border: 1px solid #f5c6cb;
        }
        .url-container {
          margin: 15px 0;
        }
        .url-input-group {
          display: flex;
          gap: 10px;
          align-items: center;
          margin-top: 8px;
        }
        .url-input {
          flex: 1;
          padding: 12px;
          border: 2px solid #28a745;
          border-radius: 8px;
          background: white;
          font-size: 14px;
          font-family: monospace;
        }
        .copy-btn {
          padding: 12px 20px;
          background: #28a745;
          color: white;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 600;
          white-space: nowrap;
        }
        .copy-btn:hover {
          background: #218838;
        }
        .view-link {
          display: inline-block;
          margin-top: 15px;
          color: #155724;
          text-decoration: underline;
          font-weight: 600;
        }
      `}</style>
      
      <div className="create-page-container">
        <h2 style={{ color: '#ff0000', marginBottom: '30px', fontSize: '28px', fontWeight: 700 }}>
          Crear Página Personalizada con IA
        </h2>
        
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">🖼️ Logo (opcional):</label>
            
            {showGidPreview && logoGid && (
              <div className="logo-preview-container">
                <p style={{ margin: '0 0 10px 0', fontWeight: 600, color: '#333' }}>Logo desde GID:</p>
                <p style={{ fontSize: '12px', color: '#666', wordBreak: 'break-all', margin: '10px 0 0 0' }}>
                  GID: {logoGid}
                </p>
              </div>
            )}
            
            <div className="form-group">
              <label style={{ fontSize: '16px', marginBottom: '8px', display: 'block', fontWeight: 600 }}>
                GID de Shopify (pega el GID aquí):
              </label>
              <input
                type="text"
                className="gid-input"
                placeholder="gid://shopify/MediaImage/123456789"
                value={logoGid}
                onChange={handleGidChange}
              />
              <small style={{ display: 'block', marginTop: '8px', color: '#666', fontSize: '14px' }}>
                💡 Pega el GID de la imagen de Shopify. Se convertirá automáticamente a URL.
              </small>
            </div>
            
            <div
              className={`logo-dropzone ${isDragging ? 'dragging' : ''}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleFileSelect}
              />
              {logoPreview ? (
                <div>
                  <img src={logoPreview} alt="Logo preview" className="logo-preview-img" />
                  <br />
                  <button
                    type="button"
                    className="remove-logo-btn"
                    onClick={removeLogo}
                  >
                    ✕ Eliminar
                  </button>
                </div>
              ) : (
                <div>
                  <p>Haz clic o arrastra una imagen aquí</p>
                </div>
              )}
            </div>
            <small style={{ display: 'block', marginTop: '8px', color: '#666', fontSize: '14px' }}>
              💡 El logo aparecerá arriba en la página personalizada. Puedes usar el GID de Shopify o subir una imagen.
            </small>
          </div>
          
          <div className="form-group">
            <label className="form-label">Prompt completo:</label>
            <textarea
              className="prompt-textarea"
              rows="12"
              required
              placeholder="Escribe aquí todo el prompt con la información del cliente. Ejemplo:

Personaliza esta página para:
- Cliente: Juan Pérez
- Empresa: Tech Solutions S.L.
- Objetivos: Aumentar ventas online en un 50%, mejorar experiencia de usuario
- Alcance: Desarrollo completo de e-commerce con integración de pagos y gestión de inventario
- Timeline: 3 meses
- Equipo: 5 desarrolladores senior especializados en React y Node.js
- Precio: €15,000

Destaca la innovación tecnológica, escalabilidad y soporte post-entrega. El tono debe ser profesional pero cercano."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <small style={{ display: 'block', marginTop: '8px', color: '#666', fontSize: '14px' }}>
              💡 Escribe toda la información del cliente y las instrucciones de personalización en un solo prompt
            </small>
          </div>
          
          <button
            type="submit"
            className="submit-btn"
            disabled={isSubmitting}
          >
            {isSubmitting ? '⏳ Generando página...' : 'Crear Página Personalizada'}
          </button>
          
          {result && (
            <div className={`result ${result.type}`}>
              <strong>{result.message}</strong>
              {result.type === 'success' && result.url && (
                <>
                  <div className="url-container">
                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>
                      🔗 URL Personalizada:
                    </label>
                    <div className="url-input-group">
                      <input
                        type="text"
                        className="url-input"
                        value={result.url}
                        readOnly
                      />
                      <button
                        type="button"
                        className="copy-btn"
                        onClick={copyUrl}
                      >
                        📋 Copiar
                      </button>
                    </div>
                    <small style={{ display: 'block', marginTop: '8px', color: '#666', fontSize: '14px' }}>
                      Click en "Copiar" para copiar la URL al portapapeles
                    </small>
                  </div>
                  <div>
                    <a href={result.url} target="_blank" rel="noopener noreferrer" className="view-link">
                      👁️ Ver página personalizada →
                    </a>
                  </div>
                </>
              )}
            </div>
          )}
        </form>
      </div>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
