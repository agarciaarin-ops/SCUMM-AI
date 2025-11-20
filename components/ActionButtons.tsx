import React from 'react';
import { ActionType } from '../types';

interface ActionButtonsProps {
  onAction: (verb: string) => void;
}

const VERBS: ActionType[] = ['Ir a', 'Mirar', 'Coger', 'Hablar con', 'Usar'];

export const ActionButtons: React.FC<ActionButtonsProps> = ({ onAction }) => {
  return (
    <div className="h-full flex flex-col">
       <h3 className="text-cyan-300 border-b border-cyan-800 mb-2 text-lg">ACCIONES</h3>
       <div className="grid grid-cols-2 gap-2">
          {VERBS.map((verb) => (
            <button
              key={verb}
              onClick={() => onAction(`${verb} `)} // Appends space for UX
              className="text-left text-cyan-100 hover:bg-cyan-900 hover:text-white px-1 py-1 text-xl transition-colors uppercase"
            >
              {verb}
            </button>
          ))}
       </div>
    </div>
  );
};