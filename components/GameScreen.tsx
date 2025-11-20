import React from 'react';
import { InventoryItem } from '../types';

interface GameScreenProps {
  imageUrl: string | null;
  loadingStatus: string | null;
  location: string;
  hoveredItem: InventoryItem | null;
  availableExits: string[];
}

export const GameScreen: React.FC<GameScreenProps> = ({ imageUrl, loadingStatus, location, hoveredItem, availableExits }) => {
  
  const hasImage = !!imageUrl;
  const isBusy = !!loadingStatus;
  const safeExits = availableExits || [];

  return (
    <div className="relative w-full aspect-video bg-black border-2 border-gray-700 overflow-hidden group shadow-lg">
      {/* Scanline overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] z-20 bg-[length:100%_4px,3px_100%] pointer-events-none"></div>
      
      {/* HUD: Location Label (Top Left) */}
      <div className="absolute top-2 left-2 z-30 bg-black/70 px-2 py-1 text-yellow-400 border border-yellow-600 text-xl shadow-[2px_2px_0px_rgba(0,0,0,1)]">
        {location}
      </div>

      {/* HUD: Available Exits (Top Right) */}
      {safeExits.length > 0 && !isBusy && (
         <div className="absolute top-2 right-2 z-30 flex flex-col items-end gap-1">
            <span className="text-xs text-green-400 bg-black px-1">SALIDAS VISIBLES</span>
            {safeExits.map((exit, i) => (
                <div key={i} className="bg-black/80 px-2 py-0.5 text-green-300 border border-green-800 text-lg hover:bg-green-900 transition-colors">
                    {exit}
                </div>
            ))}
         </div>
      )}

      {/* Main Image */}
      {hasImage ? (
        <img 
          src={imageUrl} 
          alt="Scene" 
          className="w-full h-full object-cover transition-opacity duration-500"
          style={{ imageRendering: 'pixelated' }} 
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-gray-600 font-vt323 text-xl bg-gray-900">
           {!isBusy && "NO SIGNAL"}
        </div>
      )}

      {/* Loading Overlay */}
      {isBusy && (
        <div className={`absolute inset-0 z-40 flex flex-col items-center justify-center transition-all duration-300 ${hasImage ? 'bg-black/60 backdrop-blur-[2px]' : 'bg-black'}`}>
          <div className="w-16 h-16 border-4 border-green-500 border-t-transparent rounded-full animate-spin mb-4"></div>
          <div className="bg-black border-2 border-green-600 px-6 py-3 shadow-[0_0_20px_rgba(0,255,0,0.2)]">
             <p className="text-green-400 font-vt323 text-2xl animate-pulse tracking-widest uppercase text-center">
               {loadingStatus}
             </p>
          </div>
        </div>
      )}

      {/* INVENTORY TOOLTIP OVERLAY */}
      {hoveredItem && !isBusy && (
          <div className="absolute bottom-4 left-4 right-4 z-50 bg-blue-950/95 border-2 border-white p-4 text-white shadow-[4px_4px_0_rgba(0,0,0,1)] animate-in fade-in slide-in-from-bottom-2 max-h-[60%] flex flex-col">
              <div className="flex items-start gap-3 h-full overflow-hidden">
                  <div className="text-3xl text-yellow-400 shrink-0">ℹ</div>
                  <div className="flex-1 flex flex-col overflow-hidden">
                      <h3 className="text-yellow-400 text-2xl mb-1 font-bold tracking-wider border-b border-yellow-600/30 pb-1 inline-block shrink-0">
                          {hoveredItem.name}
                      </h3>
                      <div className="overflow-y-auto pr-2 custom-scrollbar">
                        <p className="text-xl leading-relaxed font-vt323 text-gray-100 whitespace-pre-wrap break-words">
                            {hoveredItem.description}
                        </p>
                      </div>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};