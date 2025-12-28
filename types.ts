
export type VisualStyle = 'flat' | 'cartoon-3d' | 'cinematic' | 'hand-drawn' | 'pixel-art' | 'anime' | 'noir' | 'cyberpunk' | 'watercolor' | 'retro-game';

export type AudioMode = 'gemini' | 'browser' | 'custom'; // 'custom' = User Uploaded

export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:5' | '21:9';

export type SceneCount = 3 | 5 | 8;

export interface CharacterConfig {
  id: string;
  name: string;
  description: string;
  voice?: string; 
  referenceImageData?: string; // Base64 image for reference
}

export interface Character {
  id: string;
  name: string;
}

export interface DialogueLine {
  characterId: string;
  text: string;
  audioData?: string; // Base64 audio (Pre-generated)
}

export interface Scene {
  id: string;
  duration: number; // Duration in seconds
  startTime?: number; // Start time in seconds (for custom audio sync)
  endTime?: number;   // End time in seconds (for custom audio sync)
  backgroundImageUrl?: string; 
  backgroundColor?: string; // Fallback
  description: string;
  narrationAudioData?: string; // Base64 audio for the description (Pre-generated)
  characters: Character[]; // List of characters present in this scene (for context)
  script: DialogueLine[]; 
}

export interface Movie {
  title: string;
  summary: string;
  style: VisualStyle;
  audioMode: AudioMode;
  aspectRatio: AspectRatio;
  customAudioData?: string; // Base64 of the uploaded user file
  scenes: Scene[];
}

export interface GenerationState {
  status: 'idle' | 'generating' | 'playing' | 'editing' | 'finished' | 'error' | 'rendering';
  error?: string;
  loadingMessage?: string;
}
