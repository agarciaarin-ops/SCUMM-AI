
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

// Helper to clean JSON output from Markdown fences
const cleanJsonOutput = (text: string) => {
  let cleaned = text.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\n?/, '').replace(/\n?```$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\n?/, '').replace(/\n?```$/, '');
  }
  return cleaned;
};

// Helper: Retry Logic for 503/500 Errors
const callWithRetry = async (fn: () => Promise<any>, retries = 3, delay = 1000): Promise<any> => {
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
    narrative: { type: Type.STRING, description: "La respuesta narrativa del juego. MÁXIMO 80 palabras. Conciso y directo." },
    location: { type: Type.STRING, description: "El nombre de la ubicación actual." },
    visualPrompt: { type: Type.STRING, description: "Descripción visual física de la escena para generar la imagen." },
    inventory: { 
      type: Type.ARRAY, 
      items: { 
        type: Type.OBJECT,
        properties: {
            name: { type: Type.STRING, description: "Nombre NATURAL y CORTO (ej: 'Mapa', 'Botella'). MÁXIMO 3 palabras. Sin códigos."},
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
    
    TU TAREA (Pensamiento Profundo):
    1. DISEÑA EN TU MENTE el misterio completo. ¿Cuál es el final? ¿Qué puzzles llevan allí?
    2. ESTABLECE LA ESCENA INICIAL para que contenga pistas reales y lógicas hacia esa solución. Nada de generación aleatoria sin sentido.
    3. GENERA EL INVENTARIO inicial con 2-3 objetos que sean coherentes con el Mundo (${settings.world}) y útiles para el primer puzzle.
    
    SALIDA:
    - Narrativa: Intro inmersiva que establece el conflicto.
    - VisualPrompt: Describe el estilo visual acorde al Mundo (${settings.world}).
  `;

  try {
    // Using GEMINI 3 PRO for high-quality initialization (The "Big Brain" phase)
    const response = await callWithRetry(() => ai.models.generateContent({
      model: MODEL_INIT,
      contents: "Inicializa la aventura con un diseño de narrativa profundo.",
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: gameSchema,
        maxOutputTokens: 8192, 
        thinkingConfig: { thinkingBudget: 1024 } 
      }
    }));

    const jsonText = cleanJsonOutput(response.text || "{}");
    const parsed = JSON.parse(jsonText);
    
    return {
        narrative: parsed.narrative || "Error generando historia.",
        location: parsed.location || "Desconocido",
        visualPrompt: parsed.visualPrompt || "Error visual.",
        inventory: parsed.inventory || [],
        keyElements: parsed.keyElements || [],
        availableExits: parsed.availableExits || [],
        visualChanged: true
    };
  } catch (error) {
    console.error("Init Error:", error);
    throw error;
  }
};

export const generateGameResponse = async (
  userAction: string,
  currentState: GameState,
  currentImageBase64: string | null
): Promise<GameResponse> => {
  
  const { settings } = currentState;

  const systemInstruction = `
    Eres el motor lógico (Gemini 2.5 Flash) de una aventura gráfica. RÁPIDO y COHERENTE.
    
    CONTEXTO DEL JUEGO:
    - Mundo: ${settings.world} (Respeta las reglas, tecnología y magia de este universo).
    - Tono: ${settings.tone}.
    - Ubicación Actual: ${currentState.location}.
    - Misión: ${settings.objective}.
    
    REGLAS:
    - Respuestas narrativas BREVES (Max 3 frases).
    - Mantén la coherencia con el Mundo definido.
    - NUNCA cortes el JSON.
    - Inventario: Nombres naturales, sin códigos.
    - visualChanged: TRUE solo si cambia la escena visualmente (movimiento, coger item visible). FALSE si es dialogo o mirar.
  `;

  const parts: any[] = [];
  
  // 1. Add Image Context if available (Flash sees the world)
  if (currentImageBase64) {
    parts.push({
      inlineData: {
        data: cleanBase64(currentImageBase64),
        mimeType: 'image/png'
      }
    });
  }

  // 2. Add Text Prompt
  const inventoryContext = (currentState.inventory || []).map(i => i.name).join(', ');
  
  parts.push({
    text: `Acción del jugador: "${userAction}". 
    Inventario actual: [${inventoryContext}]. 
    Historia reciente: ${currentState.history.slice(-2).map(h => h.content).join(' ')}`
  });

  try {
    // Using GEMINI 2.5 FLASH for speed in the game loop (The "Fast Brain" phase)
    const response = await callWithRetry(() => ai.models.generateContent({
      model: MODEL_LOOP,
      contents: { parts },
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: gameSchema,
        maxOutputTokens: 8192, // Ensure plenty of room for JSON
      }
    }));

    const jsonText = cleanJsonOutput(response.text || "{}");
    const parsed = JSON.parse(jsonText);

    return {
        narrative: parsed.narrative || "...",
        location: parsed.location || currentState.location,
        visualPrompt: parsed.visualPrompt || currentState.visualDescription,
        inventory: parsed.inventory || currentState.inventory,
        keyElements: parsed.keyElements || [],
        availableExits: parsed.availableExits || [],
        visualChanged: parsed.visualChanged ?? true // Default to true if undefined to be safe, but prompt encourages false
    };

  } catch (error) {
    console.error("Game Response Error:", error);
    // Fallback response to keep game alive
    return {
      narrative: "El sistema se ha sobrecargado momentáneamente. Intenta otra acción.",
      location: currentState.location,
      visualPrompt: currentState.visualDescription,
      inventory: currentState.inventory,
      keyElements: [],
      availableExits: currentState.availableExits,
      visualChanged: false
    };
  }
};

export const generateSceneImage = async (
  prompt: string, 
  artStyle: string, 
  keyElements: string[] = [],
  referenceImage?: string
): Promise<string> => {
  try {
    // 1. Sanitize the Visual Prompt to avoid Safety Blocks (e.g. Alcohol references)
    const safePrompt = sanitizeVisualPrompt(prompt);

    // 2. Sanitize key elements to remove text instructions like "(NPC)", "[Broken]"
    const safeElements = (keyElements || [])
        .map(k => k.replace(/\s*\(.*?\)\s*/g, '').replace(/\s*\[.*?\]\s*/g, '').trim())
        .filter(k => k.length > 0);

    const elementsString = safeElements.length > 0 ? `VISIBLE ELEMENTS: ${safeElements.join(', ')}` : '';
    
    // Enhanced Prompt for cleaner visuals
    const enhancedPrompt = `
      ${artStyle}. Pixel art videogame screenshot. Point and click adventure.
      Scene: ${safePrompt}. 
      ${elementsString}.
      
      CRITICAL RULES:
      - SCALE: Objects must be in correct scale relative to the environment (no giant birds or items).
      - TEXT: NO floating text. NO labels. NO names above heads. Only diegetic text allowed (like neon signs on buildings).
      - UI: NO user interface elements, NO arrows, NO cursors, NO speech bubbles.
      - Perspective: Wide angle, scene view.
    `.trim();

    const makeImageCall = async (includeReference: boolean) => {
        const parts: any[] = [];

        if (includeReference && referenceImage) {
            parts.push({
                inlineData: {
                    data: cleanBase64(referenceImage),
                    mimeType: 'image/png'
                }
            });
            parts.push({ text: `Edit this image to match description: ${enhancedPrompt}` });
        } else {
            parts.push({ text: enhancedPrompt });
        }

        // Using GEMINI 2.5 FLASH IMAGE (Nano Banana)
        const response = await callWithRetry(() => ai.models.generateContent({
            model: MODEL_IMAGE,
            contents: { parts },
            config: {
            responseModalities: [Modality.IMAGE],
            },
        }));
        
        const part = response.candidates?.[0]?.content?.parts?.[0];
        if (part?.inlineData?.data) {
            return `data:image/png;base64,${part.inlineData.data}`;
        }
        throw new Error("No image data received in response");
    };

    // Attempt generation with Fallback/Recovery logic
    try {
        if (referenceImage) {
            try {
                return await makeImageCall(true);
            } catch (editError) {
                console.warn("Image Edit failed. Retrying with Fresh Generation...", editError);
                return await makeImageCall(false);
            }
        } else {
            return await makeImageCall(false);
        }
    } catch (genError) {
        console.error("Image Generation completely failed:", genError);
        // Fallback: Return a "Static/No Signal" image to prevent game crash
        // A small 1x1 dark grey pixel to keep the UI stable
        return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    }

  } catch (error) {
    console.error("Image Logic Error:", error);
    // Ultimate fallback
    return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  }
};
