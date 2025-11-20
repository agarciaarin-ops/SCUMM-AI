
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { GameState, GameSettings, InventoryItem } from './types';
import { generateGameResponse, generateSceneImage, generateInitialGameWorld } from './services/gemini';
import { GameScreen } from './components/GameScreen';
import { Terminal } from './components/Terminal';
import { Inventory } from './components/Inventory';
import { ActionButtons } from './components/ActionButtons';

// Default presets
const DEFAULT_WORLD = "Bilbao Realista con toques Mágicos";
const DEFAULT_LOCATION = "Bilbao, Casco Viejo";
const DEFAULT_STYLE = "Pixel Art Retro Monkey Island Style";
const DEFAULT_OBJECTIVE = "Encontrar la receta secreta del Kalimotxo legendario";
const DEFAULT_TONE = "Humor absurdo, sarcástico y nostálgico";

const VERBS = ['Ir a', 'Mirar', 'Coger', 'Hablar con', 'Usar'];

// Helpers: Aggressive Sanitization for Inventory Items
const sanitizeInventory = (items: InventoryItem[]): InventoryItem[] => {
    if (!items) return [];
    return items.map(item => {
        // 1. Remove underscores, technical suffixes, and error flags
        let cleanName = item.name
            .replace(/_/g, ' ') // Replace underscores with spaces
            .replace(/\s*-\s*ERROR\s*.*$/i, '') // Remove "- ERROR ..." tails
            .replace(/\b[a-f0-9]{8,}\b/gi, '') // Remove hex codes (hash-like)
            .replace(/x86|x64|v\d+(\.\d+)?/gi, '') // Remove version numbers
            .replace(/\s+/g, ' ') // Collapse multiple spaces
            .trim();

        // 2. Capitalize first letter just in case
        if (cleanName.length > 0) {
            cleanName = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
        }

        // 3. Truncate length for UI safety (Sidebar is narrow)
        if (cleanName.length > 22) {
            cleanName = cleanName.substring(0, 20) + '..';
        }

        // 4. Fallback if empty after cleaning
        if (!cleanName) cleanName = "Objeto Raro";

        return {
            ...item,
            name: cleanName,
            description: item.description || "Un objeto tan misterioso que la propia realidad (o la IA) se niega a describirlo. Huele a ozono."
        };
    });
};

// Map Key Normalization to improve cache hits (ignoring case/spaces)
const normalizeLocKey = (location: string) => location.trim().toLowerCase();

export default function App() {
  // UI State
  const [isGameStarted, setIsGameStarted] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [initStatus, setInitStatus] = useState(""); 
  const [hoveredInventoryItem, setHoveredInventoryItem] = useState<InventoryItem | null>(null);
  const [showLog, setShowLog] = useState(false); // History Log Modal State
  
  // Text Input State
  const [userInput, setUserInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll log to bottom when opened
  useEffect(() => {
    if (showLog && logEndRef.current) {
        logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [showLog]);

  // Menu Form State
  const [inputWorld, setInputWorld] = useState(DEFAULT_WORLD);
  const [inputLocation, setInputLocation] = useState(DEFAULT_LOCATION);
  const [inputStyle, setInputStyle] = useState(DEFAULT_STYLE);
  const [inputObjective, setInputObjective] = useState(DEFAULT_OBJECTIVE);
  const [inputTone, setInputTone] = useState(DEFAULT_TONE);

  // Game State
  const [gameState, setGameState] = useState<GameState>({
    settings: {
        world: DEFAULT_WORLD,
        startLocation: DEFAULT_LOCATION,
        artStyle: DEFAULT_STYLE,
        objective: DEFAULT_OBJECTIVE,
        tone: DEFAULT_TONE
    },
    location: '',
    narrative: '',
    inventory: [],
    availableExits: [],
    visualDescription: '',
    imageUrl: null,
    loadingStatus: null,
    history: [],
    knownLocations: {}
  });

  // Start Game Logic
  const handleStartGame = async () => {
    if (!inputLocation || !inputStyle) return;
    
    setIsInitializing(true);
    setInitStatus("CONECTANDO CON GEMINI 3 PRO...");
    
    const newSettings: GameSettings = {
        world: inputWorld,
        startLocation: inputLocation,
        artStyle: inputStyle,
        objective: inputObjective,
        tone: inputTone
    };

    try {
      setInitStatus("DISEÑANDO TRAMA Y MISTERIO...");
      const initialWorld = await generateInitialGameWorld(newSettings);
      
      setInitStatus("RENDERIZANDO ESCENA (NANO BANANA)...");
      const imageBase64 = await generateSceneImage(
          initialWorld.visualPrompt, 
          newSettings.artStyle, 
          initialWorld.keyElements
      );

      setGameState({
        settings: newSettings,
        location: initialWorld.location || "Desconocido",
        narrative: initialWorld.narrative || "",
        inventory: sanitizeInventory(initialWorld.inventory || []),
        availableExits: initialWorld.availableExits || [],
        visualDescription: initialWorld.visualPrompt,
        imageUrl: imageBase64,
        loadingStatus: null,
        history: [{ role: 'model' as const, content: initialWorld.narrative }],
        knownLocations: {
            [normalizeLocKey(initialWorld.location || "start")]: {
                imageUrl: imageBase64,
                visualPrompt: initialWorld.visualPrompt
            }
        }
      });
      
      setIsGameStarted(true);
    } catch (error) {
      console.error("Failed to start game:", error);
      alert("Error iniciando el motor SCUMM. Por favor intenta otra vez.");
    } finally {
      setIsInitializing(false);
      setInitStatus("");
    }
  };

  const handleAction = useCallback(async (action: string) => {
    if (gameState.loadingStatus || !action.trim()) return;

    // Optimistic UI Update
    setGameState(prev => ({ 
      ...prev, 
      loadingStatus: "ANALIZANDO ACCIÓN...",
      history: [...prev.history, { role: 'user' as const, content: action }] 
    }));
    
    setUserInput("");

    try {
      const response = await generateGameResponse(
          action, 
          gameState, 
          gameState.imageUrl
      );
      
      // Visual Logic with Persistence & Optimization
      let newImageUrl = gameState.imageUrl;
      const hasChangedLocation = response.location !== gameState.location;
      const locationKey = normalizeLocKey(response.location || "unknown");
      const hasVisualChange = response.visualChanged === true;
      
      // Optimization: Only regenerate if location changes OR explicit visual change requested
      if (hasChangedLocation) {
         // CASE A: Location Changed
         if (gameState.knownLocations[locationKey]) {
            // CACHE HIT: Load from memory
            setGameState(prev => ({ ...prev, loadingStatus: "CARGANDO UBICACIÓN..." }));
            newImageUrl = gameState.knownLocations[locationKey].imageUrl;
         } else {
             // NEW LOCATION: Generate
             setGameState(prev => ({ ...prev, loadingStatus: "GENERANDO ESCENA..." }));
             newImageUrl = await generateSceneImage(
                response.visualPrompt, 
                gameState.settings.artStyle,
                response.keyElements
             );
         }
      } 
      else if (hasVisualChange) {
         // CASE B: Same Location, but Visuals Changed (Action triggered)
         try {
            setGameState(prev => ({ ...prev, loadingStatus: "ACTUALIZANDO VISUALES..." }));
            
            // We pass current image as reference for editing
            newImageUrl = await generateSceneImage(
                response.visualPrompt, 
                gameState.settings.artStyle,
                response.keyElements,
                gameState.imageUrl || undefined
            );
         } catch (e) {
            console.error("Image update failed, keeping old image", e);
         }
      } 
      else {
         // CASE C: Same Location, No Visual Change (Dialogue, Looking)
         // Keep newImageUrl as is (current image)
      }

      setGameState(prev => {
        const newHistory = [...prev.history, { role: 'model' as const, content: response.narrative }];
        if (newHistory.length > 20) newHistory.splice(0, 5); // Keep buffer managed
        
        const updatedKnownLocations = {
            ...prev.knownLocations,
            [locationKey]: {
                imageUrl: newImageUrl || '',
                visualPrompt: response.visualPrompt
            }
        };

        return {
          ...prev,
          location: response.location || prev.location,
          narrative: response.narrative,
          inventory: sanitizeInventory(response.inventory || prev.inventory),
          availableExits: response.availableExits || [],
          visualDescription: response.visualPrompt,
          imageUrl: newImageUrl,
          history: newHistory,
          knownLocations: updatedKnownLocations,
          loadingStatus: null
        };
      });

    } catch (error) {
      console.error("Game Loop Error:", error);
      setGameState(prev => ({ 
        ...prev, 
        loadingStatus: null, 
        narrative: "El sistema se ha sobrecargado momentáneamente. Intenta otra acción." 
      }));
    }
  }, [gameState]);

  const handleVerbClick = (verb: string) => {
    setUserInput(currentInput => {
        const trimmedVerb = verb.trim();
        const existingVerb = VERBS.find(v => currentInput.toLowerCase().startsWith(v.toLowerCase()));
        if (existingVerb) {
            const rest = currentInput.slice(existingVerb.length).trim();
            return `${trimmedVerb} ${rest}`;
        }
        return `${trimmedVerb} ${currentInput}`;
    });
    inputRef.current?.focus();
  };

  // --- RENDER ---

  if (!isGameStarted) {
    return (
      <div className="min-h-screen bg-black text-green-500 font-vt323 flex flex-col items-center justify-center p-4">
         <div className="max-w-4xl w-full border-4 border-green-700 p-8 bg-gray-900 shadow-[0_0_50px_rgba(0,255,0,0.2)] text-center relative overflow-hidden">
           <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%)] bg-[length:100%_4px]"></div>
           <h1 className="text-6xl md:text-8xl mb-2 text-yellow-400 drop-shadow-[4px_4px_0_rgba(100,0,0,1)] animate-pulse">SCUMM-AI</h1>
           <p className="text-xl md:text-2xl text-cyan-400 mb-8 tracking-widest">CONFIGURADOR DE AVENTURA</p>

           <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative z-10 text-left mb-8">
             <div className="md:col-span-2 flex flex-col">
               <label className="text-lg text-green-400 mb-1">AMBIENTACIÓN / MUNDO (ej: Star Wars, Bilbao, One Piece)</label>
               <input type="text" value={inputWorld} onChange={(e) => setInputWorld(e.target.value)} className="bg-black border-2 border-green-600 text-white p-2 text-xl focus:outline-none focus:border-yellow-400"/>
             </div>
             <div className="flex flex-col">
               <label className="text-lg text-green-400 mb-1">UBICACIÓN DE INICIO</label>
               <input type="text" value={inputLocation} onChange={(e) => setInputLocation(e.target.value)} className="bg-black border-2 border-green-600 text-white p-2 text-xl focus:outline-none focus:border-yellow-400"/>
             </div>
             <div className="flex flex-col">
               <label className="text-lg text-green-400 mb-1">ESTILO GRÁFICO</label>
               <input type="text" value={inputStyle} onChange={(e) => setInputStyle(e.target.value)} className="bg-black border-2 border-green-600 text-white p-2 text-xl focus:outline-none focus:border-yellow-400"/>
             </div>
             <div className="flex flex-col">
               <label className="text-lg text-green-400 mb-1">OBJETIVO / MISIÓN</label>
               <input type="text" value={inputObjective} onChange={(e) => setInputObjective(e.target.value)} className="bg-black border-2 border-green-600 text-white p-2 text-xl focus:outline-none focus:border-yellow-400"/>
             </div>
             <div className="flex flex-col">
               <label className="text-lg text-green-400 mb-1">TONO NARRATIVO</label>
               <input type="text" value={inputTone} onChange={(e) => setInputTone(e.target.value)} className="bg-black border-2 border-green-600 text-white p-2 text-xl focus:outline-none focus:border-yellow-400"/>
             </div>
           </div>
           <button onClick={handleStartGame} disabled={isInitializing} className={`w-full max-w-md mx-auto bg-green-700 text-white text-3xl py-3 border-b-8 border-r-8 border-green-900 hover:bg-green-600 hover:border-green-800 active:translate-y-1 active:border-0 active:mb-2 transition-all ${isInitializing ? 'opacity-50 cursor-not-allowed' : ''}`}>
               {isInitializing ? initStatus : 'INICIAR AVENTURA >'}
           </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-yellow-100 p-2 md:p-4 flex flex-col items-center font-vt323">
      
      {showLog && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-gray-900 border-4 border-green-600 w-full max-w-3xl h-[80vh] flex flex-col p-4 shadow-[0_0_30px_rgba(0,255,0,0.3)]">
            <div className="flex justify-between items-center mb-4 border-b-2 border-green-800 pb-2">
              <h2 className="text-2xl text-green-400 uppercase tracking-widest">Historial de Sucesos</h2>
              <button onClick={() => setShowLog(false)} className="text-red-500 hover:text-white hover:bg-red-600 px-2 text-xl border border-transparent hover:border-white transition-colors">X CERRAR</button>
            </div>
            <div className="overflow-y-auto space-y-4 pr-4 custom-scrollbar flex-1">
              {gameState.history.map((entry, i) => (
                <div key={i} className={`p-3 border-l-4 ${entry.role === 'user' ? 'bg-gray-800 border-yellow-500 ml-8' : 'bg-black border-blue-500 mr-8'}`}>
                   <span className="text-xs uppercase tracking-wider text-gray-500 mb-1 block">{entry.role === 'user' ? 'TU ACCIÓN' : 'NARRATIVA'}</span>
                   <p className="text-lg leading-relaxed text-gray-200 font-vt323">{entry.content}</p>
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>
      )}

      <div className="w-full max-w-4xl bg-gray-800 p-2 rounded-lg border-4 border-gray-600 shadow-[0_0_20px_rgba(0,255,0,0.2)] relative">
        
        <div className="bg-blue-900 text-white p-2 mb-2 flex justify-between items-center border-b-2 border-black">
          <div className="flex flex-col truncate max-w-[60%]">
             <h1 className="text-2xl tracking-widest text-yellow-300 drop-shadow-md truncate">
                {gameState.location.toUpperCase()}
             </h1>
             <span className="text-xs text-cyan-300 truncate">OBJ: {gameState.settings.objective}</span>
          </div>
          
          <div className="flex gap-2 shrink-0">
             <button onClick={() => setShowLog(true)} className="text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1 border border-black text-green-300 uppercase tracking-wider">
               LOG / HISTORIAL
             </button>
             <button onClick={() => { setIsGameStarted(false); setIsInitializing(false); }} className="text-xs bg-red-800 hover:bg-red-700 px-2 py-1 border border-black text-white">
               SALIR
             </button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          
          <GameScreen 
            imageUrl={gameState.imageUrl} 
            loadingStatus={gameState.loadingStatus} 
            location={gameState.location}
            hoveredItem={hoveredInventoryItem}
            availableExits={gameState.availableExits || []}
          />

          <Terminal 
            text={gameState.narrative} 
            isTyping={gameState.loadingStatus !== null}
            onShowHistory={() => setShowLog(true)}
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-2 h-48 md:h-40">
            <div className="md:col-span-1 bg-black border-2 border-gray-700 p-2 overflow-y-auto">
              <ActionButtons onAction={handleVerbClick} />
            </div>
            <div className="md:col-span-1 bg-black border-2 border-gray-700 p-2">
              <Inventory 
                items={gameState.inventory} 
                onHoverItem={setHoveredInventoryItem}
              />
            </div>
            <div className="md:col-span-1 bg-black border-2 border-gray-700 p-2 flex flex-col">
               <label className="text-green-500 text-lg mb-1">¿Qué quieres hacer?</label>
               <textarea
                 ref={inputRef}
                 value={userInput}
                 onChange={(e) => setUserInput(e.target.value)}
                 disabled={gameState.loadingStatus !== null}
                 className={`flex-1 bg-gray-900 text-green-400 p-2 resize-none focus:outline-none border border-green-800 text-xl leading-tight ${gameState.loadingStatus ? 'opacity-50' : ''}`}
                 placeholder="..."
                 onKeyDown={(e) => {
                   if (e.key === 'Enter' && !e.shiftKey) {
                     e.preventDefault();
                     handleAction(userInput);
                   }
                 }}
               />
               <div className="text-gray-500 text-xs mt-1 text-right">PRESS ENTER</div>
            </div>
          </div>
        </div>
      </div>
      
      <footer className="mt-4 text-gray-600 text-sm text-center">
        Powered by Gemini 3.0 Pro & Imagen (Nano Banana) <br/> 
        World: {gameState.settings.world} | Mode: {gameState.settings.tone}
      </footer>
    </div>
  );
}
