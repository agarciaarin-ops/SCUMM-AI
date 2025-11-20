
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { GameResponse, GameState, GameSettings } from "../types";

const API_KEY = process.env.API_KEY || '';
const ai = new GoogleGenAI({ apiKey: API_KEY });

// HYBRID ARCHITECTURE CONFIGURATION
const MODEL_INIT = "gemini-3-pro-preview"; // "Big Brain" for world creation
const MODEL_LOOP = "gemini-2.5-flash";     // "Fast Brain" for gameplay actions
const MODEL_IMAGE = "gemini-2.5-flash-image"; // "Visual Cortex" - STRICTLY NANO BANANA

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

// Helper: Retry Logic for 503/500/404 Errors
const callWithRetry = async (fn: () => Promise<any>, retries = 3, delay = 500): Promise<any> => {
    try {
        return await fn();
    } catch (error: any) {
        // Retry on Server Errors (5xx) or if model is temporarily overloaded
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
           name: { type: Type.STRING, description: "Nombre corto del objeto (Max 3 palabras). SIN códigos técnicos, SIN guiones bajos." },
           description: { type: Type.STRING, description: "Descripción detallada y divertida estilo enciclopedia de aventura gráfica." }
        }
      },
      description: "La lista ACTUALIZADA del inventario." 
    },
    keyElements: { 
        type: Type.ARRAY, 
        items: { type: Type.STRING }, 
        description: "Elementos visuales clave mencionados en el texto que DEBEN aparecer en la imagen." 
    },
    availableExits: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "Lista de salidas visibles o direcciones posibles desde aquí."
    },
    visualChanged: { 
        type: Type.BOOLEAN, 
        description: "TRUE si la escena ha cambiado físicamente (entrar, romper, coger, abrir). FALSE si es solo diálogo o mirar." 
    }
  },
  required: ["narrative", "location", "visualPrompt", "inventory", "keyElements", "availableExits", "visualChanged"],
};

export const generateInitialGameWorld = async (settings: GameSettings): Promise<GameResponse> => {
  const prompt = `
    Act as a Lead Game Designer for a classic LucasArts style adventure game.
    
    GAME SETTINGS:
    - World/Universe: ${settings.world}
    - Start Location: ${settings.startLocation}
    - Art Style: ${settings.artStyle}
    - Objective: ${settings.objective}
    - Narrative Tone: ${settings.tone}

    TASK:
    Initialize the game world. Create an engaging opening scene, a protagonist description, and an initial inventory relevant to the puzzle.
    
    RULES:
    1. Output STRICT JSON matching the schema.
    2. Narrative must be ${settings.tone}, maximum 4 sentences. Use Typewriter style phrasing.
    3. Visual Prompt must be descriptive for an AI image generator (e.g., "Pixel art, [Style], [Details]"). 
       IMPORTANT: Do NOT include text labels, UI elements, or speech bubbles in the visual description.
    4. Inventory items MUST have natural names (e.g., "Rusty Key", "Rubber Chicken"). DO NOT use IDs like "Key_v1" or "Item_002".
    5. Plan the mystery so it's solvable.

    OUTPUT FORMAT:
    Return ONLY the JSON object.
  `;

  // FALLBACK LOGIC: Try Big Brain (Pro), if fail, use Fast Brain (Flash)
  try {
      console.log("Initializing with Gemini 3 Pro...");
      const response = await callWithRetry(() => ai.models.generateContent({
        model: MODEL_INIT,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: gameSchema,
          // No thinking config to ensure speed/stability
          maxOutputTokens: 8192, 
        },
      }));

      const jsonText = cleanJsonOutput(response.text || "{}");
      const parsed = tryParseJSON(jsonText);
      
      if (!parsed || !parsed.narrative) throw new Error("Invalid JSON from Pro");
      
      return { ...parsed, modelUsed: "Gemini 3.0 Pro" };

  } catch (error) {
      console.warn("Gemini 3 Pro Initialization failed, falling back to Flash...", error);
      
      // FALLBACK: Gemini 2.5 Flash
      const response = await callWithRetry(() => ai.models.generateContent({
        model: MODEL_LOOP, // Use Flash for fallback
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: gameSchema,
        },
      }));

      const jsonText = cleanJsonOutput(response.text || "{}");
      const parsed = tryParseJSON(jsonText);
      return { ...parsed, modelUsed: "Gemini 2.5 Flash (Fallback)" };
  }
};

export const generateGameResponse = async (
    userAction: string, 
    gameState: GameState, 
    currentImageBase64: string | null
): Promise<GameResponse> => {
  
  // Prepare context for the AI
  const visitedList = Object.keys(gameState.knownLocations).join(", ");
  
  // Convert complex inventory objects to a summary string for context, but ask for full objects back
  const inventoryContext = gameState.inventory.map(i => i.name).join(", ");

  const prompt = `
    CURRENT STATE:
    - World: ${gameState.settings.world}
    - Location: ${gameState.location}
    - Current Inventory: [${inventoryContext}]
    - Visited Locations: [${visitedList}]
    - Objective: ${gameState.settings.objective}
    
    USER ACTION: "${userAction}"
    
    INSTRUCTIONS:
    1. Advance the game state based on the action.
    2. If the user picks up an item, REMOVE it from the 'visualPrompt' and 'keyElements' effectively deleting it from the scene.
    3. If the user goes to a previously visited location (or similar), use the EXACT SAME Name for 'location'.
    4. VISUALS: 
       - Set 'visualChanged' to TRUE ONLY if the physical scene changes (moving, breaking, taking). 
       - Set 'visualChanged' to FALSE for talking, looking, or thinking.
    5. INVENTORY:
       - Return the FULL inventory array. Keep existing items unless used/lost. Add new items if taken.
       - Names must be short and natural (No underscores, No codes).
    6. NARRATIVE: Keep it ${gameState.settings.tone}. Max 3 sentences.
  `;

  const parts: any[] = [{ text: prompt }];
  
  // Add visual context if available (Multimodal)
  if (currentImageBase64) {
      parts.push({
          inlineData: {
              mimeType: "image/png",
              data: cleanBase64(currentImageBase64)
          }
      });
  }

  const response = await callWithRetry(() => ai.models.generateContent({
    model: MODEL_LOOP, // Flash for speed
    contents: [{ role: 'user', parts }],
    config: {
      responseMimeType: "application/json",
      responseSchema: gameSchema,
    },
  }));

  const jsonText = cleanJsonOutput(response.text || "{}");
  const parsed = tryParseJSON(jsonText);
  
  if (!parsed) {
      throw new Error("Failed to parse game response");
  }

  return parsed;
};

export const generateSceneImage = async (
    visualPrompt: string, 
    style: string, 
    keyElements: string[] = [],
    referenceImageBase64?: string
): Promise<string> => {
  
  // 1. Sanitize Key Elements
  const cleanElements = keyElements
      .map(k => k.replace(/\(NPC\)|\(Item\)|\[.*?\]/g, '').trim())
      .filter(k => k.length > 0)
      .join(", ");

  // 2. Sanitize Prompt for Safety
  const safePrompt = sanitizeVisualPrompt(visualPrompt);

  // 3. Construct the Final Prompt
  // STRICTLY NANO BANANA COMPATIBLE PROMPT
  const finalPrompt = `
    ${style} pixel art adventure game screenshot. 
    Scene: ${safePrompt}. 
    Visible Elements: ${cleanElements}.
    NO text, NO UI, NO labels, NO speech bubbles.
    Full scene, no cropping.
  `.trim();

  console.log(`Generating Image with ${MODEL_IMAGE}...`);

  try {
      // ALWAYS USE gemini-2.5-flash-image (Nano Banana) via generateContent
      // We use generateContent for both text-to-image and image-to-image in this SDK version for Flash Image model
      
      const parts: any[] = [{ text: finalPrompt }];

      // If we have a reference image (editing), add it to the prompt context
      if (referenceImageBase64) {
          parts.push({
              inlineData: {
                  mimeType: "image/png",
                  data: cleanBase64(referenceImageBase64)
              }
          });
      }

      const response = await callWithRetry(() => ai.models.generateContent({
        model: MODEL_IMAGE,
        contents: { parts },
        config: {
             // Nano Banana supports responseModalities
             responseModalities: [Modality.IMAGE],
        }
      }));

      // Extract Image
      const candidates = response.candidates;
      if (candidates && candidates[0] && candidates[0].content && candidates[0].content.parts) {
          for (const part of candidates[0].content.parts) {
              if (part.inlineData && part.inlineData.data) {
                  return `data:image/png;base64,${part.inlineData.data}`;
              }
          }
      }
      
      throw new Error("No image data received in response");

  } catch (error) {
      console.error("Image Generation Failed:", error);
      
      // Retry Logic: If Editing failed, try Fresh Generation (Text-only)
      if (referenceImageBase64) {
          console.log("Retrying without reference image...");
          return generateSceneImage(visualPrompt, style, keyElements); 
      }

      // Retry Logic: If prompt was too complex/unsafe, try Simple Prompt
      if (finalPrompt.length > 100) {
           console.log("Retrying with simplified prompt...");
           const simplePrompt = `${style} pixel art scene. ${cleanElements}`;
           try {
               const simpleRes = await ai.models.generateContent({
                   model: MODEL_IMAGE,
                   contents: { parts: [{ text: simplePrompt }] },
                   config: { responseModalities: [Modality.IMAGE] }
               });
               // Extract...
               const parts = simpleRes.candidates?.[0]?.content?.parts;
               if (parts?.[0]?.inlineData?.data) {
                   return `data:image/png;base64,${parts[0].inlineData.data}`;
               }
           } catch (e) { console.error("Simple retry failed", e); }
      }

      // FINAL FALLBACK: Return a placeholder "Static/Error" image (base64)
      // A simple 1x1 gray pixel stretched, or similar. 
      // Here we return a tiny transparent pixel to let the UI handle "NO SIGNAL"
      return ""; 
  }
};
