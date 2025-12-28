import React, { useEffect, useState, useRef } from 'react';
import { Movie, DialogueLine, AspectRatio } from '../types';
import { Play, Pause, RotateCcw, Volume2, VolumeX, Maximize, Minimize, Download } from 'lucide-react';
import { Button } from './Button';

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
  
  // Custom Audio State
  const customAudioRef = useRef<HTMLAudioElement | null>(null);

  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  // Rendering/Recording state
  const [isRendering, setIsRendering] = useState(false);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioCache = useRef<Map<string, AudioBuffer>>(new Map());
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  const scene = movie.scenes[sceneIndex];

  // --- AUDIO DECODING ---
  // We now decode all pre-generated audio on mount for smooth playback
  useEffect(() => {
    const initAudio = async () => {
        if (movie.audioMode !== 'gemini') return;
        
        const Ctx = window.AudioContext || (window as any).webkitAudioContext;
        audioCtxRef.current = new Ctx({ sampleRate: 24000 });

        // Decode everything into cache
        for(let sIdx=0; sIdx<movie.scenes.length; sIdx++) {
            const s = movie.scenes[sIdx];
            // Narration
            if (s.narrationAudioData) {
                try {
                    const buf = await decodeAudioData(decode(s.narrationAudioData), audioCtxRef.current, 24000, 1);
                    audioCache.current.set(`${s.id}-narrator`, buf);
                } catch(e) {}
            }
            // Script
            for(let lIdx=0; lIdx<s.script.length; lIdx++) {
                const line = s.script[lIdx];
                if (line.audioData) {
                    try {
                        const buf = await decodeAudioData(decode(line.audioData), audioCtxRef.current, 24000, 1);
                        audioCache.current.set(`${s.id}-line-${lIdx}`, buf);
                    } catch(e) {}
                }
            }
        }
    };
    initAudio();

    return () => {
      activeSourceRef.current?.stop();
      audioCtxRef.current?.close();
      window.speechSynthesis.cancel();
      if (customAudioRef.current) customAudioRef.current.pause();
    };
  }, [movie]);

  // --- RENDER & DOWNLOAD ---
  const startRender = async () => {
      if (!containerRef.current) return;
      
      // Stop current playback
      setIsPlaying(false);
      if (activeSourceRef.current) activeSourceRef.current.stop();
      if (customAudioRef.current) {
          customAudioRef.current.pause();
          customAudioRef.current.currentTime = 0;
      }

      // Reset positions
      setSceneIndex(0);
      setScriptIndex(-2);
      
      // Start Recording
      try {
          // We capture the container. 
          // Note: DisplayMedia captures the screen/tab. 
          // For a purely "background" render we'd need Canvas recording, but we have HTML elements (text).
          // So we must use getDisplayMedia, but we'll automate the flow.
          
          const stream = await navigator.mediaDevices.getDisplayMedia({
               video: { displaySurface: "browser" },
               audio: true
          });

          const recorder = new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp9' });
          const chunks: BlobPart[] = [];
          
          recorder.ondataavailable = (e) => { if(e.data.size > 0) chunks.push(e.data); };
          recorder.onstop = () => {
              const blob = new Blob(chunks, { type: 'video/webm' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${movie.title.replace(/\s+/g, '_')}_video.webm`;
              a.click();
              setIsRendering(false);
              setIsPlaying(false);
              stream.getTracks().forEach(t => t.stop());
          };

          mediaRecorderRef.current = recorder;
          recorder.start();
          setIsRendering(true);
          
          // Auto-start playback
          // Give a small delay for recorder to spin up
          setTimeout(() => {
              setIsPlaying(true);
              // Trigger actual play logic by setting indices
              setSceneIndex(0);
              setScriptIndex(-1);
              if (customAudioRef.current) customAudioRef.current.play();
          }, 1000);

      } catch (e) {
          console.error("Recording failed or cancelled", e);
          setIsRendering(false);
      }
  };

  // --- CUSTOM AUDIO SYNC ---
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
              if (isRendering && mediaRecorderRef.current?.state === 'recording') {
                  mediaRecorderRef.current.stop();
              } else {
                  onFinish();
              }
          }
      };

      audio.addEventListener('timeupdate', handleTimeUpdate);
      audio.addEventListener('ended', () => { 
          setIsPlaying(false); 
          if (isRendering && mediaRecorderRef.current?.state === 'recording') {
              mediaRecorderRef.current.stop();
          } else {
              onFinish();
          }
      });

      if (isPlaying) audio.play();
      else audio.pause();

      return () => {
          audio.removeEventListener('timeupdate', handleTimeUpdate);
      };
  }, [movie.audioMode, isPlaying, movie.scenes, sceneIndex, isRendering]);

  // --- GENERATED AUDIO LOOP ---
  useEffect(() => {
    if (movie.audioMode === 'custom') return; 
    if (!isPlaying) return;

    const currentScene = movie.scenes[sceneIndex];
    if (!currentScene) {
        setIsPlaying(false);
        if (isRendering && mediaRecorderRef.current?.state === 'recording') {
            mediaRecorderRef.current.stop();
        } else {
            onFinish();
        }
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
        // If audio disabled during standard playback (not rendering), skip audio
        // BUT if rendering, we probably want audio unless explicitly muted? 
        // Let's respect audioEnabled for now.
        if (!audioEnabled) {
             const duration = Math.max(2000, text.length * 60);
             const timer = setTimeout(nextStep, duration);
             return () => clearTimeout(timer);
        }

        if (movie.audioMode === 'browser') {
            const utterance = new SpeechSynthesisUtterance(text);
            // Browser detect lang logic: usually auto, but we can try to guess or default
            // Since script is in detected language, browser usually handles it well.
            utterance.onend = () => setTimeout(nextStep, 500);
            window.speechSynthesis.speak(utterance);
        } else {
            // Gemini Mode (Pre-generated)
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

    // A. Narrator
    if (scriptIndex === -1) {
        setCurrentLine(null);
        setIsNarrating(true);
        const narrKey = `${currentScene.id}-narrator`;
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
        const audioKey = `${currentScene.id}-line-${scriptIndex}`;
        
        handlePlaybackStep(line.text, audioKey, () => {
            setScriptIndex(prev => prev + 1);
        });
    } 
    // C. End of Scene
    else if (scriptIndex >= currentScene.script.length) {
        setCurrentLine(null);
        if (sceneIndex < movie.scenes.length - 1) {
             setSceneIndex(prev => prev + 1);
             setScriptIndex(-1);
        } else {
            setIsPlaying(false);
            if (isRendering && mediaRecorderRef.current?.state === 'recording') {
                mediaRecorderRef.current.stop();
            } else {
                onFinish();
            }
        }
    }
  }, [isPlaying, sceneIndex, scriptIndex, audioEnabled, movie.audioMode, isRendering]);

  const toggleFullscreen = async () => {
      if (!containerRef.current) return;
      if (!document.fullscreenElement) {
          await containerRef.current.requestFullscreen();
          setIsFullscreen(true);
      } else {
          await document.exitFullscreen();
          setIsFullscreen(false);
      }
  };

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

      {/* Controls Overlay (Top) - HIDDEN DURING RENDERING */}
      {!isRendering && (
          <div className={`
              bg-slate-900 p-4 border-b border-slate-800 flex justify-between items-center shrink-0 z-40
              ${isFullscreen ? 'absolute top-0 left-0 w-full bg-slate-900/80 backdrop-blur opacity-0 group-hover:opacity-100 border-none transition-opacity' : 'w-full'}
          `}>
            <div>
               <h2 className="text-xl font-bold text-white shadow-black drop-shadow-md truncate max-w-[200px] md:max-w-md">{movie.title}</h2>
               <div className="flex gap-2 text-sm text-slate-400">
                 <span>Сцена {sceneIndex + 1} / {movie.scenes.length}</span>
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
                <button onClick={startRender} className="p-2 hover:bg-indigo-600 rounded-full text-white transition backdrop-blur-sm ml-2 bg-indigo-700" title="Render Video">
                    <Download size={20} />
                </button>
                <button onClick={toggleFullscreen} className="p-2 hover:bg-slate-800/80 rounded-full text-white transition backdrop-blur-sm border-l border-white/10 pl-4">
                    {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
                </button>
            </div>
          </div>
      )}

      {/* Rendering Indicator */}
      {isRendering && (
          <div className="absolute top-4 right-4 z-50 bg-red-600 text-white px-3 py-1 rounded-full text-xs font-bold animate-pulse shadow-lg">
              REC ●
          </div>
      )}

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
                    Generating Visuals...
                </div>
            )}

            {/* Subtitles / Narrator */}
            {(isNarrating || (movie.audioMode === 'custom' && scene.script.length > 0)) && (
                <div className="absolute inset-0 flex items-end justify-center pb-12 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none z-20">
                     <div className="max-w-4xl text-center animate-fade-in px-8">
                        <p className={`text-indigo-100 font-serif italic leading-relaxed text-shadow ${isFullscreen || isRendering ? 'text-3xl' : 'text-xl md:text-2xl'}`}>
                            "{scene.description}"
                        </p>
                     </div>
                </div>
            )}

            {/* Dialogue Overlay */}
            {currentLine && movie.audioMode !== 'custom' && (
                <div className="absolute bottom-10 left-1/2 transform -translate-x-1/2 z-20 w-full max-w-2xl px-4 pointer-events-none">
                    <div className={`animate-pop-in bg-white/90 backdrop-blur text-black p-4 rounded-2xl shadow-xl border-2 border-black comic-font leading-tight text-center ${isFullscreen || isRendering ? 'text-2xl' : 'text-lg'}`}>
                        <span className="block text-xs font-bold text-indigo-600 mb-1 uppercase tracking-wider">{currentLine.characterId}</span>
                        {currentLine.text}
                    </div>
                </div>
            )}
        </div>
      </div>

      {/* Progress Bar (Hidden during Render) */}
      {!isRendering && (
          <div className={`h-1 bg-slate-800 w-full relative shrink-0 ${isFullscreen ? 'absolute bottom-0 left-0 right-0 z-30' : ''}`}>
             <div 
                className="h-full bg-indigo-500 transition-all duration-300"
                style={{ width: `${((sceneIndex + 1) / movie.scenes.length) * 100}%` }}
             />
          </div>
      )}
      
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