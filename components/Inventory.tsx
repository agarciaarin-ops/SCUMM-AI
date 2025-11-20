import React from 'react';
import { InventoryItem } from '../types';

interface InventoryProps {
  items: InventoryItem[];
  onHoverItem: (item: InventoryItem | null) => void;
}

export const Inventory: React.FC<InventoryProps> = ({ items, onHoverItem }) => {
  return (
    <div className="h-full flex flex-col relative">
      <h3 className="text-purple-300 border-b border-purple-800 mb-2 text-lg">INVENTARIO</h3>
      
      {items.length === 0 ? (
        <div className="text-gray-500 italic text-sm">Bolsillos vacíos</div>
      ) : (
        <ul className="space-y-1 overflow-y-auto flex-1 relative z-10">
          {items.map((item, idx) => (
            <li 
              key={idx} 
              className="flex items-center gap-2 text-purple-100 text-lg hover:text-white cursor-help group relative truncate"
              onMouseEnter={() => onHoverItem(item)}
              onMouseLeave={() => onHoverItem(null)}
            >
               <span className="text-purple-500 text-xs shrink-0">►</span> 
               <span className="truncate">{item.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};