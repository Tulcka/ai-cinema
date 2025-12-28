import React, { useState, useRef, useEffect } from 'react';
import { Movie, Scene } from '../types';
import { Trash2, ArrowUp, ArrowDown, Volume2, StopCircle, Plus, Sparkles, X, Loader2 } from 'lucide-react';
import { generateSpeech, generateSceneFromPrompt } from '../services/geminiService';
import { Button } from './Button';

interface SceneEditorProps {
  movie: Movie;
  onUpdateMovie: (movie: Movie) => void;
  onClose: () => void;
}

// Helpers for PCM Decoding (duplicated)
function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export const SceneEditor: React.FC<SceneEditorProps> = ({ movie, onUpdateMovie, onClose }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Audio Playback State
  const [playingSceneId, setPlayingSceneId] = useState<string | null>(null);
  const [loadingAudioId, setLoadingAudioId] = useState<string | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
        if (activeSourceRef.current) activeSourceRef.current.stop();
        if (audioCtxRef.current) audioCtxRef.current.close();
        window.speechSynthesis.cancel();
    }
  }, []);

  const handlePlayDescription = async (scene: Scene, index: number) => {
    const id = scene.id || String(index);
    
    // Stop if currently playing this scene
    if (playingSceneId === id) {
        if (activeSourceRef.current) activeSourceRef.current.stop();
        window.speechSynthesis.cancel();
        setPlayingSceneId(null);
        return;
    }

    // Stop any other playback
    if (activeSourceRef.current) activeSourceRef.current.stop();
    window.speechSynthesis.cancel();

    if (movie.audioMode === 'browser') {
        setPlayingSceneId(id);
        const utterance = new SpeechSynthesisUtterance(scene.description);
        utterance.lang = 'ru-RU';
        utterance.onend = () => setPlayingSceneId(null);
        utterance.onerror = () => setPlayingSceneId(null);
        window.speechSynthesis.speak(utterance);
    } else {
        // Gemini Mode
        setLoadingAudioId(id);
        try {
            if (!audioCtxRef.current) {
                 const Ctx = window.AudioContext || (window as any).webkitAudioContext;
                 audioCtxRef.current = new Ctx({ sampleRate: 24000 });
            }
            if (audioCtxRef.current.state === 'suspended') {
                await audioCtxRef.current.resume();
            }

            // Generate speech (using 'Fenrir' as narrator voice)
            const audioData = await generateSpeech(scene.description, 'Fenrir'); 
            
            if (audioData) {
                const buffer = await decodeAudioData(decode(audioData), audioCtxRef.current, 24000, 1);
                const source = audioCtxRef.current.createBufferSource();
                source.buffer = buffer;
                source.connect(audioCtxRef.current.destination);
                source.onended = () => setPlayingSceneId(null);
                activeSourceRef.current = source;
                
                setLoadingAudioId(null);
                setPlayingSceneId(id);
                source.start();
            } else {
                setLoadingAudioId(null);
                alert("Не удалось сгенерировать аудио.");
            }
        } catch (e) {
            console.error(e);
            setLoadingAudioId(null);
            setPlayingSceneId(null);
        }
    }
  };

  const handleMoveScene = (index: number, direction: 'up' | 'down') => {
    const newScenes = [...movie.scenes];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    
    if (targetIndex >= 0 && targetIndex < newScenes.length) {
      [newScenes[index], newScenes[targetIndex]] = [newScenes[targetIndex], newScenes[index]];
      onUpdateMovie({ ...movie, scenes: newScenes });
    }
  };

  const handleDeleteScene = (index: number) => {
    if (movie.scenes.length <= 1) return; 
    const newScenes = movie.scenes.filter((_, i) => i !== index);
    onUpdateMovie({ ...movie, scenes: newScenes });
  };

  const handleGenerateScene = async () => {
      if(!prompt.trim()) return;
      setIsLoading(true);
      try {
          const newScene = await generateSceneFromPrompt(prompt, movie);
          onUpdateMovie({ ...movie, scenes: [...movie.scenes, newScene] });
          setPrompt("");
          setIsAdding(false);
      } catch (e) {
          alert("Ошибка генерации сцены");
      } finally {
          setIsLoading(false);
      }
  };

  return (
    <div className="w-full max-w-4xl mx-auto bg-slate-900 rounded-2xl border border-slate-700 overflow-hidden flex flex-col h-[700px]">
      <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-slate-800">
        <h3 className="text-lg font-bold text-white">Редактор Сцен</h3>
        <button 
          onClick={onClose}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-bold transition"
        >
          Готово
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
        {movie.scenes.map((scene, index) => {
            const sceneId = scene.id || String(index);
            const isPlaying = playingSceneId === sceneId;
            const isLoadingAudio = loadingAudioId === sceneId;

            return (
              <div key={sceneId} className="bg-slate-800 p-4 rounded-xl border border-slate-700 flex items-center gap-4 hover:border-indigo-500/50 transition-colors">
                
                {/* Scene Preview (Mini) */}
                <div className="w-24 h-16 bg-slate-900 rounded-lg overflow-hidden relative shrink-0 border border-slate-600">
                  {scene.backgroundImageUrl ? (
                      <img src={scene.backgroundImageUrl} className="w-full h-full object-cover" alt="scene" />
                  ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs text-slate-500">Generating...</div>
                  )}
                  <div className="absolute top-0 left-0 bg-black/60 text-white text-[10px] px-1">
                    #{index + 1}
                  </div>
                </div>

                {/* Controls */}
                <div className="flex-1 min-w-0 flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-300 truncate font-medium">{scene.description}</p>
                      <p className="text-xs text-slate-500 mt-1">Реплик: {scene.script.length}</p>
                  </div>
                  <button 
                    onClick={() => handlePlayDescription(scene, index)}
                    disabled={isLoadingAudio}
                    className="p-1.5 rounded-full hover:bg-indigo-500/20 text-indigo-400 transition shrink-0"
                    title="Озвучить описание"
                  >
                    {isLoadingAudio ? (
                        <Loader2 size={16} className="animate-spin" />
                    ) : isPlaying ? (
                        <StopCircle size={16} />
                    ) : (
                        <Volume2 size={16} />
                    )}
                  </button>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 border-l border-slate-700 pl-2">
                  <div className="flex flex-col gap-1">
                    <button 
                      onClick={() => handleMoveScene(index, 'up')}
                      disabled={index === 0}
                      className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button 
                      onClick={() => handleMoveScene(index, 'down')}
                      disabled={index === movie.scenes.length - 1}
                      className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ArrowDown size={16} />
                    </button>
                  </div>
                  <button 
                    onClick={() => handleDeleteScene(index)}
                    className="p-2 hover:bg-red-500/20 text-slate-400 hover:text-red-400 rounded transition ml-2"
                    title="Удалить сцену"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            );
        })}
      </div>

      {/* Add Scene Area */}
      <div className="p-4 bg-slate-800 border-t border-slate-700">
          {!isAdding ? (
              <button 
                onClick={() => setIsAdding(true)}
                className="w-full py-3 border-2 border-dashed border-slate-600 rounded-xl text-slate-400 font-bold hover:bg-slate-700/50 hover:text-white hover:border-indigo-500 transition flex items-center justify-center gap-2"
              >
                  <Plus size={20} /> Добавить сцену
              </button>
          ) : (
              <div className="space-y-3 animate-fade-in bg-slate-900 p-4 rounded-xl border border-indigo-500/50">
                  <div className="flex justify-between items-center mb-2">
                      <span className="text-sm font-bold text-indigo-400 flex items-center gap-2">
                          <Sparkles size={14} /> Новая сцена
                      </span>
                      <button onClick={() => setIsAdding(false)} className="text-slate-500 hover:text-white"><X size={16}/></button>
                  </div>
                  <textarea 
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Опиши, что происходит в новой сцене..."
                    className="w-full bg-slate-800 p-3 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    rows={2}
                  />
                  <div className="flex justify-end">
                      <Button onClick={handleGenerateScene} isLoading={isLoading} disabled={!prompt.trim()}>
                          Сгенерировать
                      </Button>
                  </div>
              </div>
          )}
      </div>
    </div>
  );
};
