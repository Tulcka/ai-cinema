import React, { useEffect, useState, useRef } from 'react';
import { Movie, DialogueLine, AspectRatio } from '../types';
import { Play, Pause, RotateCcw, Volume2, VolumeX, Maximize, Minimize } from 'lucide-react';
import { generateSpeech } from '../services/geminiService';

interface MovieScreenProps {
  movie: Movie;
  voices: Map<string, string>;
  onFinish: () => void;
}

// Helpers for PCM Decoding
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

const getAspectRatioStyle = (ratio: AspectRatio): React.CSSProperties => {
    switch (ratio) {
        case '16:9': return { aspectRatio: '16/9' };
        case '9:16': return { aspectRatio: '9/16' };
        case '1:1': return { aspectRatio: '1/1' };
        case '4:5': return { aspectRatio: '4/5' };
        case '21:9': return { aspectRatio: '21/9' };
        default: return { aspectRatio: '16/9' };
    }
};

export const MovieScreen: React.FC<MovieScreenProps> = ({ movie, voices, onFinish }) => {
  const [sceneIndex, setSceneIndex] = useState(0);
  const [scriptIndex, setScriptIndex] = useState(-2); 
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentLine, setCurrentLine] = useState<DialogueLine | null>(null);
  const [isNarrating, setIsNarrating] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [isPreparingAudio, setIsPreparingAudio] = useState(false);
  
  // Custom Audio State
  const customAudioRef = useRef<HTMLAudioElement | null>(null);

  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioCache = useRef<Map<string, AudioBuffer>>(new Map());
  
  const scene = movie.scenes[sceneIndex];

  // --- BROWSER TTS HELPER ---
  const speakBrowser = (text: string, onEnd: () => void) => {
    if (!window.speechSynthesis) {
        onEnd();
        return;
    }
    
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ru-RU';
    utterance.rate = 1.0;
    
    utterance.onend = () => { onEnd(); };
    utterance.onerror = () => { onEnd(); };

    window.speechSynthesis.speak(utterance);
  };

  useEffect(() => {
    if (movie.audioMode === 'gemini') {
        const Ctx = window.AudioContext || (window as any).webkitAudioContext;
        audioCtxRef.current = new Ctx({ sampleRate: 24000 });
    }
    return () => {
      activeSourceRef.current?.stop();
      audioCtxRef.current?.close();
      window.speechSynthesis.cancel();
      if (customAudioRef.current) {
          customAudioRef.current.pause();
      }
    };
  }, [movie.audioMode]);

  const toggleFullscreen = async () => {
      if (!containerRef.current) return;
      try {
          if (!document.fullscreenElement) {
              await containerRef.current.requestFullscreen();
              // State update is handled by event listener
          } else {
              await document.exitFullscreen();
              // State update is handled by event listener
          }
      } catch (err) {
          console.error(err);
          setIsFullscreen(!isFullscreen);
      }
  };

  useEffect(() => {
      const handleFsChange = () => {
          setIsFullscreen(document.fullscreenElement === containerRef.current);
      };
      document.addEventListener('fullscreenchange', handleFsChange);
      return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const getAudioKey = (sIdx: number, lIdx: number) => {
      if (lIdx === -1) return `${movie.scenes[sIdx].id}-narrator`; 
      return `${movie.scenes[sIdx].id}-line-${lIdx}`;
  };

  // --- PREPARE AUDIO (GENERATED MODE) ---
  const prepareSceneAudio = async (idx: number) => {
    const s = movie.scenes[idx];
    if (!s) return;

    if (movie.audioMode === 'browser' || movie.audioMode === 'custom') {
        setIsPreparingAudio(false);
        return;
    }

    if (audioCtxRef.current?.state === 'suspended') {
        await audioCtxRef.current.resume();
    }

    setIsPreparingAudio(true);

    const narrKey = getAudioKey(idx, -1);
    if (!audioCache.current.has(narrKey) && s.description) {
        const narrAudio = await generateSpeech(s.description, voices.get('narrator') || 'Fenrir');
        if (narrAudio && audioCtxRef.current) {
             const buffer = await decodeAudioData(decode(narrAudio), audioCtxRef.current, 24000, 1);
             audioCache.current.set(narrKey, buffer);
        }
    }

    for (let lIdx = 0; lIdx < s.script.length; lIdx++) {
      const line = s.script[lIdx];
      const key = getAudioKey(idx, lIdx);
      if (audioCache.current.has(key)) continue;

      let voice = voices.get(line.characterId);
      if (!voice) voice = 'Puck'; 

      const audioBase64 = await generateSpeech(line.text, voice);
      if (audioBase64 && audioCtxRef.current) {
        try {
            const buffer = await decodeAudioData(decode(audioBase64), audioCtxRef.current, 24000, 1);
            audioCache.current.set(key, buffer);
        } catch (err) { console.error(err) }
      }
      await new Promise(r => setTimeout(r, 800)); 
    }
    setIsPreparingAudio(false);
  };

  // --- CUSTOM AUDIO SYNC LOOP ---
  useEffect(() => {
      if (movie.audioMode !== 'custom' || !customAudioRef.current) return;

      const audio = customAudioRef.current;
      
      const handleTimeUpdate = () => {
          const t = audio.currentTime;
          const activeIndex = movie.scenes.findIndex(s => {
              const start = s.startTime ?? 0;
              const end = s.endTime ?? Infinity;
              return t >= start && t < end;
          });

          if (activeIndex !== -1 && activeIndex !== sceneIndex) {
              setSceneIndex(activeIndex);
          }

          const lastScene = movie.scenes[movie.scenes.length - 1];
          if (lastScene.endTime && t >= lastScene.endTime) {
              setIsPlaying(false);
              onFinish();
          }
      };

      audio.addEventListener('timeupdate', handleTimeUpdate);
      audio.addEventListener('ended', () => { setIsPlaying(false); onFinish(); });

      if (isPlaying) audio.play();
      else audio.pause();

      return () => {
          audio.removeEventListener('timeupdate', handleTimeUpdate);
      };
  }, [movie.audioMode, isPlaying, movie.scenes, sceneIndex]);

  // Initial Load
  useEffect(() => {
    if (movie.audioMode !== 'custom') {
        prepareSceneAudio(0).then(() => {
            setIsPlaying(true);
            setScriptIndex(-1);
        });
    } else {
        setIsPlaying(true);
    }
  }, []);

  // --- GENERATED AUDIO LOOP ---
  useEffect(() => {
    if (movie.audioMode === 'custom') return; 
    if (!isPlaying || isPreparingAudio) return;

    const currentScene = movie.scenes[sceneIndex];
    if (!currentScene) {
        setIsPlaying(false);
        onFinish();
        return;
    }

    const playAudioBuffer = (buffer: AudioBuffer, onEnd: () => void) => {
        if (!audioCtxRef.current) return;
        if (activeSourceRef.current) activeSourceRef.current.stop();

        const source = audioCtxRef.current.createBufferSource();
        source.buffer = buffer;
        source.connect(audioCtxRef.current.destination);
        source.onended = onEnd;
        source.start();
        activeSourceRef.current = source;
    };

    const handlePlaybackStep = (text: string, audioKey: string, nextStep: () => void) => {
        if (!audioEnabled) {
             const duration = Math.max(2000, text.length * 60);
             const timer = setTimeout(nextStep, duration);
             return () => clearTimeout(timer);
        }

        if (movie.audioMode === 'browser') {
            speakBrowser(text, () => {
                setTimeout(nextStep, 500);
            });
        } else {
            const buffer = audioCache.current.get(audioKey);
            if (buffer) {
                playAudioBuffer(buffer, () => {
                    setTimeout(nextStep, 500);
                });
            } else {
                const duration = Math.max(2000, text.length * 60);
                setTimeout(nextStep, duration);
            }
        }
    };

    // A. Narrator
    if (scriptIndex === -1) {
        setCurrentLine(null);
        setIsNarrating(true);
        const narrKey = getAudioKey(sceneIndex, -1);
        const text = currentScene.description || "";
        
        handlePlaybackStep(text, narrKey, () => {
            setIsNarrating(false);
            setScriptIndex(0);
        });
    } 
    // B. Dialogue
    else if (scriptIndex >= 0 && scriptIndex < currentScene.script.length) {
        const line = currentScene.script[scriptIndex];
        setCurrentLine(line);
        setIsNarrating(false);
        const audioKey = getAudioKey(sceneIndex, scriptIndex);
        
        handlePlaybackStep(line.text, audioKey, () => {
            setScriptIndex(prev => prev + 1);
        });
    } 
    // C. End of Scene
    else if (scriptIndex >= currentScene.script.length) {
        setCurrentLine(null);
        if (sceneIndex < movie.scenes.length - 1) {
             const nextIdx = sceneIndex + 1;
             prepareSceneAudio(nextIdx).then(() => {
                 setSceneIndex(nextIdx);
                 setScriptIndex(-1);
             });
        } else {
            setIsPlaying(false);
            onFinish();
        }
    }
  }, [isPlaying, isPreparingAudio, sceneIndex, scriptIndex, audioEnabled, movie.audioMode]);

  const handleRestart = () => {
    if (activeSourceRef.current) activeSourceRef.current.stop();
    if (customAudioRef.current) {
        customAudioRef.current.currentTime = 0;
        customAudioRef.current.play();
    }
    window.speechSynthesis.cancel();
    setSceneIndex(0);
    setScriptIndex(-1);
    setIsPlaying(true);
  };

  return (
    <div 
        ref={containerRef}
        className={`${
            isFullscreen 
                ? 'fixed inset-0 z-50 w-screen h-screen bg-black flex flex-col justify-center items-center' 
                : 'w-full max-w-4xl mx-auto rounded-2xl relative bg-black flex flex-col'
        } shadow-2xl shadow-indigo-500/20 border border-slate-800 transition-all duration-300 group`}
    >
      
      {/* Hidden Audio Element for Custom Mode */}
      {movie.audioMode === 'custom' && movie.customAudioData && (
          <audio 
             ref={customAudioRef} 
             src={`data:audio/mp3;base64,${movie.customAudioData}`} 
             muted={!audioEnabled}
          />
      )}

      {/* Controls Overlay (Top) */}
      <div className={`
          bg-slate-900 p-4 border-b border-slate-800 flex justify-between items-center shrink-0 z-40
          ${isFullscreen ? 'absolute top-0 left-0 w-full bg-slate-900/80 backdrop-blur opacity-0 group-hover:opacity-100 border-none transition-opacity' : 'w-full'}
      `}>
        <div>
           <h2 className="text-xl font-bold text-white shadow-black drop-shadow-md truncate max-w-[200px] md:max-w-md">{movie.title}</h2>
           <div className="flex gap-2 text-sm text-slate-400">
             <span>Сцена {sceneIndex + 1} / {movie.scenes.length}</span>
             {movie.audioMode === 'custom' && <span className="text-yellow-400 text-xs px-2 py-0.5 border border-yellow-500/30 rounded">Custom Audio</span>}
           </div>
        </div>
        <div className="flex gap-2">
            <button onClick={() => setAudioEnabled(!audioEnabled)} className="p-2 hover:bg-slate-800/80 rounded-full text-white transition backdrop-blur-sm">
                {audioEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
            </button>
            <button onClick={() => setIsPlaying(!isPlaying)} className="p-2 hover:bg-slate-800/80 rounded-full text-white transition backdrop-blur-sm">
                {isPlaying ? <Pause size={20} /> : <Play size={20} />}
            </button>
            <button onClick={handleRestart} className="p-2 hover:bg-slate-800/80 rounded-full text-white transition backdrop-blur-sm">
                <RotateCcw size={20} />
            </button>
            <button onClick={toggleFullscreen} className="p-2 hover:bg-slate-800/80 rounded-full text-white transition backdrop-blur-sm ml-2 border-l border-white/10 pl-4">
                {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
            </button>
        </div>
      </div>

      {/* Viewport Container */}
      <div 
        className={`relative overflow-hidden bg-slate-900 mx-auto transition-all duration-500 ${
            isFullscreen ? 'max-w-full max-h-full' : 'w-full'
        }`}
        style={getAspectRatioStyle(movie.aspectRatio)}
      >
        <div className="w-full h-full relative">
            {/* Background Image Only */}
            {scene.backgroundImageUrl ? (
                <img 
                    src={scene.backgroundImageUrl} 
                    className="absolute inset-0 w-full h-full object-cover animate-pan-zoom"
                    alt="background"
                />
            ) : (
                <div className="w-full h-full bg-slate-800 flex items-center justify-center text-slate-500">
                    Image Generating...
                </div>
            )}

            {/* Subtitles (For custom audio) or Narrator */}
            {(isNarrating || (movie.audioMode === 'custom' && scene.script.length > 0)) && (
                <div className="absolute inset-0 flex items-end justify-center pb-12 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none z-20">
                     <div className="max-w-4xl text-center animate-fade-in px-8">
                        <p className={`text-indigo-100 font-serif italic leading-relaxed text-shadow ${isFullscreen ? 'text-3xl' : 'text-xl md:text-2xl'}`}>
                            "{scene.description}"
                        </p>
                     </div>
                </div>
            )}

            {/* Dialogue Overlay */}
            {currentLine && movie.audioMode !== 'custom' && (
                <div className="absolute bottom-10 left-1/2 transform -translate-x-1/2 z-20 w-full max-w-2xl px-4 pointer-events-none">
                    <div className={`animate-pop-in bg-white/90 backdrop-blur text-black p-4 rounded-2xl shadow-xl border-2 border-black comic-font leading-tight text-center ${isFullscreen ? 'text-2xl' : 'text-lg'}`}>
                        <span className="block text-xs font-bold text-indigo-600 mb-1 uppercase tracking-wider">{currentLine.characterId}</span>
                        {currentLine.text}
                    </div>
                </div>
            )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className={`h-1 bg-slate-800 w-full relative shrink-0 ${isFullscreen ? 'absolute bottom-0 left-0 right-0 z-30' : ''}`}>
         <div 
            className="h-full bg-indigo-500 transition-all duration-300"
            style={{ width: `${((sceneIndex + 1) / movie.scenes.length) * 100}%` }}
         />
      </div>
      
      <style>{`
        .text-shadow { text-shadow: 0 2px 4px rgba(0,0,0,0.8); }
        @keyframes pop-in {
            0% { opacity: 0; transform: translateY(10px); }
            100% { opacity: 1; transform: translateY(0); }
        }
        .animate-pop-in { animation: pop-in 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; }
        @keyframes pan-zoom {
            0% { transform: scale(1); }
            50% { transform: scale(1.05); }
            100% { transform: scale(1); }
        }
        .animate-pan-zoom { animation: pan-zoom 20s infinite ease-in-out alternate; }
      `}</style>
    </div>
  );
};
