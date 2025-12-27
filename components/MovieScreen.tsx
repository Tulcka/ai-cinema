import React, { useEffect, useState, useRef } from 'react';
import { Movie, Scene, DialogueLine } from '../types';
import { Play, Pause, RotateCcw, Volume2, VolumeX } from 'lucide-react';
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

export const MovieScreen: React.FC<MovieScreenProps> = ({ movie, voices, onFinish }) => {
  const [sceneIndex, setSceneIndex] = useState(0);
  const [scriptIndex, setScriptIndex] = useState(-2); 
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentLine, setCurrentLine] = useState<DialogueLine | null>(null);
  const [isNarrating, setIsNarrating] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [isPreparingAudio, setIsPreparingAudio] = useState(false);

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
    
    // Cancel previous
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ru-RU'; // Default to Russian
    utterance.rate = 1.0;

    // Try to vary pitch based on character if possible, but basic browser TTS is limited
    // We can try to pick a voice, but it's flaky across browsers.
    // For now, standard voice.
    
    utterance.onend = () => {
        onEnd();
    };
    utterance.onerror = () => {
        onEnd();
    };

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
    };
  }, [movie.audioMode]);

  const getAudioKey = (sIdx: number, lIdx: number) => {
      if (lIdx === -1) return `${movie.scenes[sIdx].id}-narrator`; 
      return `${movie.scenes[sIdx].id}-line-${lIdx}`;
  };

  // Pre-fetch Audio (Only for Gemini Mode)
  const prepareSceneAudio = async (idx: number) => {
    const s = movie.scenes[idx];
    if (!s) return;

    if (movie.audioMode === 'browser') {
        // No pre-loading needed for browser TTS
        setIsPreparingAudio(false);
        return;
    }

    if (audioCtxRef.current?.state === 'suspended') {
        await audioCtxRef.current.resume();
    }

    setIsPreparingAudio(true);

    // 1. Narrator
    const narrKey = getAudioKey(idx, -1);
    if (!audioCache.current.has(narrKey) && s.description) {
        const narrAudio = await generateSpeech(s.description, voices.get('narrator') || 'Fenrir');
        if (narrAudio && audioCtxRef.current) {
             const buffer = await decodeAudioData(decode(narrAudio), audioCtxRef.current, 24000, 1);
             audioCache.current.set(narrKey, buffer);
        }
        await new Promise(r => setTimeout(r, 500)); 
    }

    // 2. Script
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
        } catch (err) {
            console.error("Audio decoding failed", err);
        }
      }
      await new Promise(r => setTimeout(r, 800)); 
    }

    setIsPreparingAudio(false);
  };

  // Initial Load
  useEffect(() => {
    prepareSceneAudio(0).then(() => {
        setIsPlaying(true);
        setScriptIndex(-1);
    });
  }, []);

  // Main Playback Loop
  useEffect(() => {
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
            // Gemini Audio
            const buffer = audioCache.current.get(audioKey);
            if (buffer) {
                playAudioBuffer(buffer, () => {
                    setTimeout(nextStep, 500);
                });
            } else {
                // Fallback if audio gen failed
                const duration = Math.max(2000, text.length * 60);
                setTimeout(nextStep, duration);
            }
        }
    };

    // A. Narrator Phase
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
    // B. Dialogue Phase
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
  }, [isPlaying, isPreparingAudio, sceneIndex, scriptIndex, audioEnabled]);

  const handleRestart = () => {
    if (activeSourceRef.current) activeSourceRef.current.stop();
    window.speechSynthesis.cancel();
    setSceneIndex(0);
    setScriptIndex(-1);
    setIsPlaying(true);
  };

  const activeChar = currentLine ? scene.characters.find(c => c.id === currentLine.characterId) : null;

  return (
    <div className="w-full max-w-4xl mx-auto bg-black rounded-2xl overflow-hidden shadow-2xl shadow-indigo-500/20 border border-slate-800 flex flex-col">
      
      {/* Title Bar */}
      <div className="bg-slate-900 p-4 border-b border-slate-800 flex justify-between items-center">
        <div>
           <h2 className="text-xl font-bold text-white">{movie.title}</h2>
           <div className="flex gap-2 text-sm text-slate-400">
             <span>Сцена {sceneIndex + 1} / {movie.scenes.length}</span>
             {isPreparingAudio && <span className="text-indigo-400 animate-pulse">• Загрузка аудио...</span>}
             {movie.audioMode === 'browser' && <span className="text-green-400 text-xs px-2 py-0.5 border border-green-500/30 rounded">Lite Audio</span>}
           </div>
        </div>
        <div className="flex gap-2">
            <button onClick={() => {
                setAudioEnabled(!audioEnabled);
                if(audioEnabled) window.speechSynthesis.cancel();
            }} className="p-2 hover:bg-slate-800 rounded-full text-white transition">
                {audioEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
            </button>
            <button onClick={() => {
                if (isPlaying) {
                    setIsPlaying(false);
                    activeSourceRef.current?.stop();
                    window.speechSynthesis.pause();
                } else {
                    setIsPlaying(true);
                    if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume();
                    window.speechSynthesis.resume();
                }
            }} className="p-2 hover:bg-slate-800 rounded-full text-white transition">
                {isPlaying ? <Pause size={20} /> : <Play size={20} />}
            </button>
            <button onClick={handleRestart} className="p-2 hover:bg-slate-800 rounded-full text-white transition">
                <RotateCcw size={20} />
            </button>
        </div>
      </div>

      {/* Viewport */}
      <div className="relative aspect-video w-full bg-slate-900 overflow-hidden">
        
        <div className="w-full h-full relative">
            
            {/* Background */}
            {movie.mode === 'image' && scene.backgroundImageUrl ? (
                <img 
                    src={scene.backgroundImageUrl} 
                    className="absolute inset-0 w-full h-full object-cover animate-pan-zoom"
                    alt="background"
                />
            ) : (
                <svg viewBox="0 0 100 100" className="w-full h-full block absolute inset-0" style={{ backgroundColor: scene.backgroundColor }} preserveAspectRatio="xMidYMid slice">
                     <g dangerouslySetInnerHTML={{ __html: scene.backgroundSvg || '' }} />
                </svg>
            )}

            {/* Characters (SVG Mode Only) */}
            {movie.mode === 'svg' && scene.characters.map((char, idx) => {
                const isActive = activeChar && activeChar.id === char.id;
                
                const containerStyle: React.CSSProperties = {
                    position: 'absolute',
                    left: `${char.x}%`,
                    top: `${char.y}%`,
                    width: '20%',
                    height: '20%',
                    transform: `translate(-50%, -50%) scale(${char.scale || 1})`,
                    transformOrigin: 'bottom center',
                    zIndex: isActive ? 10 : 1
                };

                return (
                    <div 
                        key={char.id + idx}
                        style={containerStyle}
                        className={`transition-all duration-1000 ease-in-out anim-${char.animation || 'idle'}`}
                    >
                         <svg viewBox="0 0 20 20" className="w-full h-full overflow-visible">
                            <g transform="translate(10, 10)">
                                <g dangerouslySetInnerHTML={{ __html: char.svgBody || '' }} />
                            </g>
                         </svg>
                    </div>
                );
            })}

            {/* Narrator Text Overlay */}
            {isNarrating && (
                <div className="absolute inset-0 flex items-end justify-center pb-12 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none">
                     <div className="max-w-2xl text-center animate-fade-in px-4">
                        <p className="text-xl md:text-2xl text-indigo-100 font-serif italic leading-relaxed text-shadow">
                            "{scene.description}"
                        </p>
                     </div>
                </div>
            )}

            {/* Dialogue Overlay */}
            {currentLine && (
                <div 
                    className="absolute transform -translate-x-1/2 -translate-y-full pb-6 pointer-events-none z-20 transition-all duration-300"
                    style={{ 
                        left: activeChar ? `${activeChar.x}%` : '50%', 
                        top: activeChar ? `${activeChar.y - 15}%` : '80%',
                        maxWidth: '40%',
                        minWidth: '150px'
                    }}
                >
                    <div className="animate-pop-in bg-white text-black p-4 rounded-2xl rounded-bl-none shadow-xl border-2 border-black comic-font text-base md:text-lg leading-tight relative">
                        {currentLine.text}
                        <div className="absolute -bottom-2 left-4 w-4 h-4 bg-white border-b-2 border-r-2 border-black transform rotate-45"></div>
                    </div>
                </div>
            )}
        </div>
      </div>

      <div className="h-1 bg-slate-800 w-full relative">
         <div 
            className="h-full bg-indigo-500 transition-all duration-300"
            style={{ width: `${((sceneIndex) / movie.scenes.length) * 100}%` }}
         />
      </div>

      <style>{`
        .text-shadow { text-shadow: 0 2px 4px rgba(0,0,0,0.8); }
        @keyframes pop-in {
            0% { opacity: 0; transform: scale(0.8) translateY(10px); }
            100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        .animate-pop-in { animation: pop-in 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; }
        @keyframes pan-zoom {
            0% { transform: scale(1); }
            50% { transform: scale(1.05); }
            100% { transform: scale(1); }
        }
        .animate-pan-zoom { animation: pan-zoom 20s infinite ease-in-out alternate; }
        .anim-idle { animation: idle 3s infinite ease-in-out; }
        @keyframes idle {
            0%, 100% { transform: translate(-50%, -50%) scale(1); }
            50% { transform: translate(-50%, -50%) translateY(-2%) scale(1.02); }
        }
      `}</style>
    </div>
  );
};