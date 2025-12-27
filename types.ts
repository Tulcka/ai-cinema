export type VisualStyle = 'flat' | 'cartoon-3d' | 'cinematic' | 'hand-drawn' | 'pixel-art' | 'anime' | 'noir' | 'cyberpunk' | 'watercolor' | 'retro-game';

export type GenerationMode = 'svg' | 'image';
export type AudioMode = 'gemini' | 'browser'; // 'gemini' = AI High Quality, 'browser' = Free/Unlimited

export type SceneCount = 3 | 5 | 8;

export interface CharacterConfig {
  id: string;
  name: string;
  description: string;
  voice?: string; 
  referenceImageData?: string; // Base64 image for reference
}

export type AnimationType = 'idle' | 'float' | 'bounce' | 'shake' | 'walk' | 'pulse' | 'stretch' | 'wobble';

export interface Character {
  id: string;
  name: string;
  svgBody?: string;
  imageUrl?: string;
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
  backgroundSvg?: string; 
  backgroundImageUrl?: string; 
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
  audioMode: AudioMode;
  scenes: Scene[];
}

export interface GenerationState {
  status: 'idle' | 'generating' | 'playing' | 'editing' | 'finished' | 'error';
  error?: string;
  loadingMessage?: string;
}