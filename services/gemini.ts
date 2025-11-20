import { GoogleGenAI, Type, Modality } from "@google/genai";
import { GameResponse, GameState, GameSettings } from "../types";

const API_KEY = process.env.API_KEY || '';
const ai = new GoogleGenAI({ apiKey: API_KEY });

// HYBRID ARCHITECTURE CONFIGURATION
const MODEL_INIT = "gemini-3-pro-preview"; // "Big Brain" for world creation
const MODEL_LOOP = "gemini-2.5-flash";     // "Fast Brain" for gameplay actions
const MODEL_IMAGE = "gemini-2.5-flash-image"; // "Visual Cortex"

// Helper to strip data:image prefix
const cleanBase64 = (dataUrl: string) => dataUrl.replace(/^data:image\/(png|jpeg|jpg);base64,/, '');

// Helper to clean JSON output using substring extraction (Most Robust)
const cleanJsonOutput = (text: string) => {
  let cleaned = text.trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  
  if (firstBrace !== -1 && lastBrace !== -1) {
    return cleaned.substring(firstBrace, lastBrace + 1);
  }
  return cleaned;
};

// Helper: Robust JSON Parser with Auto-Repair for truncated responses
const tryParseJSON = (jsonString: string) => {
  try {
    return JSON.parse(jsonString);
  } catch (e) {
    // Attempt 1: Check if it's just missing the closing brace
    try {
        return JSON.parse(jsonString + '}');
    } catch (e2) {
        // Attempt 2: Check if it's missing a closing array and brace
        try {
            return JSON.parse(jsonString + ']}');
        } catch (e3) {
             // Attempt 3: If it ends with a quote (truncated string value), close quote and brace
             if (jsonString.trim().endsWith('"')) {
                 try {
                    return JSON.parse(jsonString + '}');
                 } catch(e4) {}
             } else {
                 // Ends in middle of string? Close quote then brace
                 try {
                    return JSON.parse(jsonString + '"}');
                 } catch(e5) {}
             }
        }
    }
    console.warn("JSON Auto-Repair failed. Original text length:", jsonString.length);
    return null;
  }
};

// Helper: Retry Logic for 503/500 Errors
const callWithRetry = async (fn: () => Promise<any>, retries = 3, delay = 500): Promise<any> => {
    try {
        return await fn();
    } catch (error: any) {
        if (retries > 0 && (error?.status === 503 || error?.code === 503 || error?.status === 500 || error?.message?.includes("503"))) {
            console.warn(`API Error ${error?.status || 'Unknown'}. Retrying in ${delay}ms... (${retries} attempts left)`);
            await new Promise(res => setTimeout(res, delay));
            return callWithRetry(fn, retries - 1, delay * 2);
        }
        throw error;
    }
};

// Helper to sanitize visual prompts to avoid Safety Filters (alcohol, violence, etc)
const sanitizeVisualPrompt = (text: string) => {
    return text
        .replace(/kalimotxo|calimocho/gi, "dark red potion")
        .replace(/alcohol|wine|vino|beer|cerveza/gi, "beverage")
        .replace(/coca cola|pepsi/gi, "soda")
        .replace(/brand|logo/gi, "symbol")
        .replace(/blood|gore/gi, "red liquid")
        .replace(/kill|murder|dead/gi, "defeated");
};

const gameSchema = {
  type: Type.OBJECT,
  properties: {
    narrative: { type: Type.STRING, description: "La respuesta narrativa del juego. MÁXIMO 50 palabras. Conciso y directo." },
    location: { type: Type.STRING, description: "El nombre de la ubicación actual." },
    visualPrompt: { type: Type.STRING, description: "Descripción visual física de la escena para generar la imagen." },
    inventory: { 
      type: Type.ARRAY, 
      items: { 
        type: Type.OBJECT,
        properties: {
            name: { type: Type.STRING, description: "Nombre NATURAL y CORTO (ej: 'Mapa', 'Botella'). MÁXIMO 3 palabras. SIN sufijos técnicos, SIN guiones bajos, SIN versiones."},
            description: { type: Type.STRING, description: "Descripción ingeniosa del objeto. MÁXIMO 2 frases."}
        }
      },
      description: "La lista completa y actualizada de objetos en el inventario."
    },
    keyElements: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Lista EXHAUSTIVA de objetos visuales importantes para la imagen."
    },
    availableExits: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Lista explícita de salidas visibles (ej: 'Norte', 'Puerta')."
    },
    visualChanged: {
      type: Type.BOOLEAN,
      description: "CRÍTICO: TRUE solo si hay cambios físicos visibles en la escena (moverse, coger/tirar objeto visible, abrir puerta). FALSE si es solo diálogo, mirar o pensar."
    }
  },
  required: ["narrative", "location", "visualPrompt", "inventory", "keyElements", "availableExits", "visualChanged"]
};

export const generateInitialGameWorld = async (settings: GameSettings): Promise<GameResponse> => {
  const systemInstruction = `
    Eres el ARQUITECTO MAESTRO de una aventura gráfica compleja.
    
    CONFIGURACIÓN:
    - Universo/Mundo: "${settings.world}"
    - Ubicación Inicial: "${settings.startLocation}"
    - Misión Final: "${settings.objective}"
    - Tono: "${settings.tone}"
    
    TU TAREA:
    1. DISEÑA el misterio completo.
    2. ESTABLECE LA ESCENA INICIAL con pistas lógicas.
    3. GENERA EL INVENTARIO inicial con MÁXIMO 3 objetos coherentes.
    
    RESTRICCIONES CRÍTICAS:
    - NARRATIVA: MÁXIMO 3 frases. No escribas novelas.
    - INVENTARIO: Nombres HUMANOS (ej: "Llave Vieja"). PROHIBIDO usar sufijos "_V1", "FIX", "ERROR".
    - VISUAL PROMPT: Describe solo lo físico para Pixel Art.
    - SALIDA: JSON VÁLIDO.
  `;

  const generateWithModel = async (model: string) => {
      const response = await callWithRetry(() => ai.models.generateContent({
        model: model,
        contents: "Inicializa la aventura. Genera JSON válido y completo.",
        config: {
          systemInstruction: systemInstruction,
          responseMimeType: "application/json",
          responseSchema: gameSchema,
          maxOutputTokens: 4096, // Reduced to prevent massive runaway outputs
        }
      }));
      return response;
  };

  try {
    // ATTEMPT 1: Try High-Intelligence Model (Gemini 3 Pro)
    console.log("Initializing with Big Brain (Gemini 3 Pro)...");
    const response = await generateWithModel(MODEL_INIT);
    const jsonText = cleanJsonOutput(response.text || "{}");
    const parsed = tryParseJSON(jsonText);

    if (parsed) return mapParsedResponse(parsed, settings);

    throw new Error("Gemini 3 Pro returned invalid JSON");

  } catch (error) {
    console.warn("Gemini 3 Pro Init Failed, Falling back to Flash...", error);
    
    // ATTEMPT 2: Fallback to Fast Model (Gemini 2.5 Flash)
    try {
        const response = await generateWithModel(MODEL_LOOP);
        const jsonText = cleanJsonOutput(response.text || "{}");
        const parsed = tryParseJSON(jsonText);
        
        if (parsed) return mapParsedResponse(parsed, settings);
        
    } catch (flashError) {
        console.error("Critical Init Failure (Both Models):", flashError);
    }

    // ULTIMATE FALLBACK
    return {
        narrative: "El sistema se ha reiniciado tras una inestabilidad cuántica. Estás en el punto de inicio.",
        location: settings.startLocation,
        visualPrompt: `A pixel art scene of ${settings.startLocation} in ${settings.artStyle} style.`,
        inventory: [],
        keyElements: [],
        availableExits: [],
        visualChanged: true
    };
  }
};

const mapParsedResponse = (parsed: any, settings: GameSettings): GameResponse => ({
    narrative: parsed.narrative || "Comienza la aventura...",
    location: parsed.location || settings.startLocation,
    visualPrompt: parsed.visualPrompt || `Scene of ${settings.startLocation}`,
    inventory: parsed.inventory || [],
    keyElements: parsed.keyElements || [],
    availableExits: parsed.availableExits || [],
    visualChanged: true
});

export const generateGameResponse = async (
  userAction: string,
  currentState: GameState,
  currentImageBase64: string | null
): Promise<GameResponse> => {
  
  const { settings } = currentState;
  const knownLocs = Object.keys(currentState.knownLocations).join(', ');

  const systemInstruction = `
    Eres el motor lógico (Gemini 2.5 Flash) de una aventura gráfica. RÁPIDO y COHERENTE.
    
    CONTEXTO DEL JUEGO:
    - Mundo: ${settings.world}.
    - Tono: ${settings.tone}.
    - Ubicación Actual: ${currentState.location}.
    - Misión: ${settings.objective}.
    - UBICACIONES YA VISITADAS (CACHE): [${knownLocs}]
    
    REGLAS:
    - Respuestas narrativas BREVES (Max 3 frases).
    - Inventario: Nombres naturales.
    - SI VUELVE A UNA UBICACIÓN DE LA LISTA DE CACHE, USA EL MISMO NOMBRE EXACTO.
    - VISUALCHANGED: TRUE solo si hay cambios físicos visibles (ej: abrir puerta, romper cosa). FALSE si solo habla/mira.
  `;

  try {
    const parts: any[] = [{ text: `ACCIÓN DEL JUGADOR: "${userAction}"` }];
    
    // Multimodal context: Only add image if available
    if (currentImageBase64) {
        parts.unshift({
            inlineData: {
                mimeType: "image/png",
                data: cleanBase64(currentImageBase64)
            }
        });
    }

    const response = await callWithRetry(() => ai.models.generateContent({
      model: MODEL_LOOP, // Using Flash for Game Loop (Speed)
      contents: { parts },
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: gameSchema,
      }
    }));

    const jsonText = cleanJsonOutput(response.text || "{}");
    const parsed = tryParseJSON(jsonText);

    if (parsed) return mapParsedResponse(parsed, settings);

    // Soft Error (keep game running)
    return {
        narrative: "La realidad parpadea. Intenta esa acción de nuevo.",
        location: currentState.location,
        visualPrompt: currentState.visualDescription,
        inventory: currentState.inventory,
        keyElements: [],
        availableExits: currentState.availableExits,
        visualChanged: false
    };

  } catch (error) {
    console.error("Game Loop Error:", error);
    throw error;
  }
};

export const generateSceneImage = async (
    visualPrompt: string, 
    style: string, 
    keyElements: string[] = [],
    referenceImageBase64?: string
): Promise<string> => {
  
  // Clean key elements to remove text artifacts like "(NPC)" or "-> arrow"
  const cleanElements = keyElements
    .map(el => el.replace(/\(.*\)/g, '').replace(/\[.*\]/g, '').trim())
    .filter(el => el.length > 0)
    .join(", ");

  const sanitizedPrompt = sanitizeVisualPrompt(visualPrompt);

  const fullPrompt = `
    ${style}. Retro video game screenshot. 
    Scene: ${sanitizedPrompt}. 
    Key Elements visible: ${cleanElements}.
    NO TEXT. NO UI. NO LABELS. NO SPEECH BUBBLES.
    Scale: Realistic relative to character.
    Diegetic elements only.
  `;

  const generate = async (prompt: string, refImage?: string) => {
      const parts: any[] = [{ text: prompt }];
      if (refImage) {
          parts.push({
            inlineData: {
              mimeType: "image/png",
              data: cleanBase64(refImage)
            }
          });
      }
      
      const response = await callWithRetry(() => ai.models.generateContent({
        model: MODEL_IMAGE,
        contents: { parts },
        config: {
            responseModalities: [Modality.IMAGE],
        }
      }), 2); // Retry twice max for images

      const base64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64) throw new Error("No image data");
      return `data:image/png;base64,${base64}`;
  };

  try {
    // Attempt 1: Full fidelity with reference (if provided)
    return await generate(fullPrompt, referenceImageBase64);
  } catch (error) {
    console.warn("Image Gen attempt 1 failed. Retrying simpler prompt...", error);
    
    // Attempt 2: Retry without reference (sometimes ref image causes safety blocks) OR simpler prompt
    try {
        // Simplify prompt: just the style and the first sentence of visual prompt
        const simplePrompt = `${style}. ${sanitizedPrompt.split('.')[0]}. NO TEXT.`;
        return await generate(simplePrompt);
    } catch (err2) {
        console.error("Image Gen completely failed", err2);
        // Fallback to a placeholder or previous image if possible, but for now return empty to handle in UI
        // Returning a static placeholder base64 (1x1 transparent or a static asset pattern)
        // Use a simple colored placeholder for "Signal Lost" effect
        return ""; 
    }
  }
};