
export interface GameSettings {
  world: string; // New: The universe context (e.g., "Star Wars", "Monkey Island")
  startLocation: string;
  artStyle: string;
  objective: string;
  tone: string;
}

export interface VisitedLocation {
  imageUrl: string;
  visualPrompt: string;
}

export interface InventoryItem {
  name: string;
  description: string;
}

export interface GameState {
  settings: GameSettings;
  location: string;
  narrative: string;
  inventory: InventoryItem[];
  availableExits: string[]; // New: List of valid navigation paths
  visualDescription: string;
  imageUrl: string | null;
  loadingStatus: string | null;
  history: { role: 'user' | 'model'; content: string }[];
  knownLocations: Record<string, VisitedLocation>;
}

export interface GameResponse {
  narrative: string;
  location: string;
  visualPrompt: string;
  inventory: InventoryItem[];
  keyElements: string[];
  availableExits: string[]; // New: Extracted exits
  visualChanged?: boolean; // New: Explicit flag to control image regeneration
}

export type ActionType = 'Ir a' | 'Mirar' | 'Coger' | 'Hablar con' | 'Usar';

export interface ActionButtonProps {
  onAction: (action: string) => void;
}
