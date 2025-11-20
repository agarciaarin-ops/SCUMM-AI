import React, { useState, useEffect } from 'react';

interface TerminalProps {
  text: string;
  isTyping: boolean;
  onShowHistory: () => void;
}

export const Terminal: React.FC<TerminalProps> = ({ text, isTyping, onShowHistory }) => {
  const [displayedText, setDisplayedText] = useState("");

  useEffect(() => {
    if (isTyping) {
      setDisplayedText(""); // Clear when AI is thinking
      return;
    }

    let currentIndex = 0;
    setDisplayedText(""); // Reset before starting
    
    // Faster typing speed for better UX (20ms)
    const intervalId = setInterval(() => {
      if (currentIndex < text.length) {
        setDisplayedText(text.slice(0, currentIndex + 1));
        currentIndex++;
      } else {
        clearInterval(intervalId);
      }
    }, 20);

    return () => clearInterval(intervalId);
  }, [text, isTyping]);

  return (
    <div className="bg-blue-800 border-2 border-blue-600 p-4 min-h-[100px] shadow-inner relative group">
      {/* History Trigger Button */}
      <button 
        onClick={onShowHistory}
        className="absolute top-2 right-2 bg-blue-900 hover:bg-blue-700 text-cyan-300 text-xs px-2 py-1 border border-cyan-700 opacity-50 group-hover:opacity-100 transition-opacity uppercase tracking-widest"
        title="Ver historial de textos"
      >
        ▲ LOG
      </button>

      <p className={`text-xl md:text-2xl text-white leading-relaxed font-vt323 pr-12`}>
        {isTyping ? (
          <span className="animate-pulse">Pensando...</span>
        ) : (
          <>
            {displayedText}
            <span className="animate-pulse inline-block w-3 h-6 bg-white ml-1 align-middle"></span>
          </>
        )}
      </p>
    </div>
  );
};