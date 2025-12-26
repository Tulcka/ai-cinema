export type VisualStyle = 'flat' | 'cartoon-3d' | 'cinematic' | 'hand-drawn' | 'pixel-art';

export type GenerationMode = 'svg' | 'image';

export interface CharacterConfig {
  id: string;
  name: string;
  description: string;
  voice?: string; // Voice name for TTS
}

export type AnimationType = 'idle' | 'float' | 'bounce' | 'shake' | 'walk' | 'pulse' | 'stretch' | 'wobble';

export interface Character {
  id: string;
  name: string;
  svgBody?: string; // Used in SVG mode
  imageUrl?: string; // Used in Image mode
  x: number; 
  y: number; 
  scale: number; 
  animation: AnimationType;
}

export interface DialogueLine {
  characterId: string;
  text: string;
  audioData?: string; // Base64 audio
}

export interface Scene {
  id: string;
  duration: number; 
  backgroundSvg?: string; // Used in SVG mode
  backgroundImageUrl?: string; // Used in Image mode
  backgroundColor: string; 
  description: string;
  characters: Character[];
  script: DialogueLine[]; 
}

export interface Movie {
  title: string;
  summary: string;
  style: VisualStyle;
  mode: GenerationMode;
  scenes: Scene[];
}

export interface GenerationState {
  status: 'idle' | 'generating' | 'playing' | 'editing' | 'finished' | 'error';
  error?: string;
  loadingMessage?: string;
}