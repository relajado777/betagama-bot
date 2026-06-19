import dotenv from 'dotenv';
import fetch from 'node-fetch'; // En Node 18+ fetch está disponible globalmente, pero para compatibilidad usaremos el global

dotenv.config();

async function list() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("❌ No hay GEMINI_API_KEY configurada en el archivo .env");
    return;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
  try {
    console.log("🔍 Consultando modelos disponibles en Google AI Studio...");
    const response = await globalThis.fetch(url);
    const data = await response.json();
    
    if (data.error) {
      console.error("❌ Error de API de Google:", data.error);
      return;
    }

    console.log("✅ Modelos disponibles encontrados:");
    if (data.models && Array.isArray(data.models)) {
      data.models.forEach(model => {
        if (model.supportedGenerationMethods && model.supportedGenerationMethods.includes("generateContent")) {
          console.log(`- ${model.name.replace("models/", "")} (${model.displayName})`);
        }
      });
    } else {
      console.log("No se devolvió lista de modelos o el formato es inusual:", data);
    }
  } catch (error) {
    console.error("❌ Error de red:", error);
  }
}

list();
