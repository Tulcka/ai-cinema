import React, { useState, useRef } from 'react';
import { generateMovie, assignVoices } from './services/geminiService';
import { Movie, GenerationState, VisualStyle, CharacterConfig, GenerationMode, SceneCount, AudioMode } from './types';
import { MovieScreen } from './components/MovieScreen';
import { SceneEditor } from './components/SceneEditor';
import { Button } from './components/Button';
import { Sparkles, Video, Clapperboard, Palette, Users, Plus, X, Edit, PlayCircle, Download, Image as ImageIcon, PenTool, Upload, Mic, MicOff, Music } from 'lucide-react';

const STYLES: { id: VisualStyle; label: string; desc: string }[] = [
  { id: 'flat', label: 'Flat 2D', desc: 'Минимализм' },
  { id: 'cartoon-3d', label: '3D Pixar', desc: 'Объем' },
  { id: 'cinematic', label: 'Кино', desc: 'Реализм' },
  { id: 'anime', label: 'Аниме', desc: 'Ghibli' },
  { id: 'noir', label: 'Нуар', desc: 'ЧБ Детектив' },
  { id: 'cyberpunk', label: 'Cyberpunk', desc: 'Неон' },
  { id: 'watercolor', label: 'Акварель', desc: 'Арт' },
  { id: 'retro-game', label: 'Pixel Art', desc: 'Ретро' },
];

export default function App() {
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState<VisualStyle>('flat');
  const [mode, setMode] = useState<GenerationMode>('image'); // Default to Image for better quality
  const [audioMode, setAudioMode] = useState<AudioMode>('gemini');
  const [sceneCount, setSceneCount] = useState<SceneCount>(3);
  
  const [characters, setCharacters] = useState<CharacterConfig[]>([]);
  const [newCharName, setNewCharName] = useState('');
  const [newCharDesc, setNewCharDesc] = useState('');
  const [newCharImg, setNewCharImg] = useState<string | null>(null);
  const [isAddingChar, setIsAddingChar] = useState(false);

  const [movie, setMovie] = useState<Movie | null>(null);
  const [voiceMap, setVoiceMap] = useState<Map<string, string>>(new Map());
  const [genState, setGenState] = useState<GenerationState>({ status: 'idle' });

  // Screen recording state
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    
    setGenState({ status: 'generating' });
    try {
      const generatedMovie = await generateMovie(prompt, style, mode, sceneCount, audioMode, characters);
      const assignedVoices = assignVoices(generatedMovie, characters);
      
      setMovie(generatedMovie);
      setVoiceMap(assignedVoices);
      setGenState({ status: 'playing' });
    } catch (error) {
      setGenState({ status: 'error', error: 'Не удалось создать фильм. Попробуйте упростить запрос.' });
    }
  };

  const handleFinish = () => {
    setGenState({ status: 'finished' });
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          const reader = new FileReader();
          reader.onloadend = () => {
              setNewCharImg(reader.result as string);
          };
          reader.readAsDataURL(file);
      }
  };

  const addCharacter = () => {
    if (newCharName.trim() && newCharDesc.trim()) {
      setCharacters([...characters, {
        id: Date.now().toString(),
        name: newCharName,
        description: newCharDesc,
        referenceImageData: newCharImg || undefined
      }]);
      setNewCharName('');
      setNewCharDesc('');
      setNewCharImg(null);
      setIsAddingChar(false);
    }
  };

  const removeCharacter = (id: string) => {
    setCharacters(characters.filter(c => c.id !== id));
  };

  const updateMovie = (updatedMovie: Movie) => {
    setMovie(updatedMovie);
  };

  const startRecording = async () => {
    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ 
            video: { displaySurface: "browser" }, 
            audio: true 
        });
        
        const recorder = new MediaRecorder(stream);
        const chunks: BlobPart[] = [];
        
        recorder.ondataavailable = (e) => chunks.push(e.data);
        recorder.onstop = () => {
            const blob = new Blob(chunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${movie?.title || 'animation'}.webm`;
            a.click();
            setIsRecording(false);
            
            // Stop tracks
            stream.getTracks().forEach(track => track.stop());
        };
        
        recorder.start();
        setIsRecording(true);
        mediaRecorderRef.current = recorder;
    } catch (e) {
        console.error("Recording failed", e);
        if (e instanceof Error && e.name === 'NotAllowedError') {
             // User cancelled or blocked
             return; 
        }
        alert("Запись недоступна (browser restrictions).");
    }
  };

  const stopRecording = () => {
      mediaRecorderRef.current?.stop();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white flex flex-col font-sans">
      
      {/* Header */}
      <header className="p-6 border-b border-white/10 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-tr from-indigo-500 to-purple-500 p-2 rounded-lg">
                <Clapperboard className="text-white" size={24} />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">AI Cinema</h1>
          </div>
          {movie && genState.status !== 'generating' && (
             <button 
                onClick={() => { setMovie(null); setGenState({ status: 'idle' }); setPrompt(''); setCharacters([]); }}
                className="text-sm text-slate-400 hover:text-white transition"
             >
                Новый Фильм
             </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-8 flex flex-col items-center">
        
        {/* INPUT CONFIGURATION STATE */}
        {!movie && genState.status !== 'generating' && (
          <div className="w-full max-w-3xl mt-6 animate-fade-in space-y-8 pb-20">
            <div className="text-center mb-8">
                <h2 className="text-4xl font-extrabold mb-4 bg-clip-text text-transparent bg-gradient-to-r from-indigo-300 via-white to-purple-300">
                    Сам себе режиссер
                </h2>
                <p className="text-slate-400 text-lg">
                   Создавай анимации с помощью Gemini AI
                </p>
            </div>

            {/* 1. Prompt */}
            <div className="bg-slate-800/50 p-6 rounded-2xl border border-white/10 shadow-lg">
                <label className="block text-sm font-bold text-slate-300 mb-3 uppercase tracking-wider">История</label>
                <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Например: Шерлок Холмс раскрывает дело о пропавшем коте в киберпанк-городе..."
                    className="w-full bg-slate-900/50 text-white p-4 text-lg rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none min-h-[100px] placeholder:text-slate-600 border border-transparent"
                />
            </div>

            {/* 2. Visual Style & Mode */}
            <div className="bg-slate-800/50 p-6 rounded-2xl border border-white/10 shadow-lg">
                <div className="flex justify-between items-center mb-4">
                     <label className="flex items-center gap-2 text-sm font-bold text-slate-300 uppercase tracking-wider">
                        <Palette size={16} /> Настройки
                     </label>
                </div>
                
                {/* Visual Mode */}
                <div className="flex flex-wrap gap-4 mb-6">
                    <div className="bg-slate-900 p-1 rounded-lg inline-flex border border-slate-700">
                        <button onClick={() => setMode('svg')} className={`px-4 py-2 rounded-md flex items-center gap-2 text-sm font-bold transition ${mode === 'svg' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>
                            <PenTool size={16} /> SVG
                        </button>
                        <button onClick={() => setMode('image')} className={`px-4 py-2 rounded-md flex items-center gap-2 text-sm font-bold transition ${mode === 'image' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>
                            <ImageIcon size={16} /> Images
                        </button>
                    </div>

                    <div className="bg-slate-900 p-1 rounded-lg inline-flex border border-slate-700">
                        <button onClick={() => setAudioMode('gemini')} className={`px-4 py-2 rounded-md flex items-center gap-2 text-sm font-bold transition ${audioMode === 'gemini' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>
                            <Music size={16} /> AI Voice
                        </button>
                        <button onClick={() => setAudioMode('browser')} className={`px-4 py-2 rounded-md flex items-center gap-2 text-sm font-bold transition ${audioMode === 'browser' ? 'bg-green-600 text-white' : 'text-slate-400'}`}>
                            <Mic size={16} /> Lite (Free)
                        </button>
                    </div>

                    <div className="bg-slate-900 p-1 rounded-lg inline-flex border border-slate-700 items-center px-3 gap-2">
                        <span className="text-xs text-slate-400 uppercase font-bold">Сцены:</span>
                        <select 
                            value={sceneCount} 
                            onChange={(e) => setSceneCount(Number(e.target.value) as SceneCount)}
                            className="bg-transparent text-white font-bold outline-none text-sm"
                        >
                            <option value={3}>3 (Короткий)</option>
                            <option value={5}>5 (Средний)</option>
                            <option value={8}>8 (Длинный)</option>
                        </select>
                    </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {STYLES.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setStyle(s.id)}
                      className={`p-3 rounded-xl text-left transition border ${style === s.id ? 'bg-indigo-600 border-indigo-400 shadow-indigo-500/30 shadow-lg' : 'bg-slate-900/50 border-slate-700 hover:bg-slate-700'}`}
                    >
                      <div className="font-bold text-sm mb-1">{s.label}</div>
                      <div className="text-xs text-slate-400 leading-tight">{s.desc}</div>
                    </button>
                  ))}
                </div>
            </div>

            {/* 3. Characters */}
            <div className="bg-slate-800/50 p-6 rounded-2xl border border-white/10 shadow-lg">
                <div className="flex justify-between items-center mb-4">
                  <label className="flex items-center gap-2 text-sm font-bold text-slate-300 uppercase tracking-wider">
                    <Users size={16} /> Кастинг
                  </label>
                  {!isAddingChar && (
                    <button onClick={() => setIsAddingChar(true)} className="text-xs flex items-center gap-1 text-indigo-400 hover:text-indigo-300 font-bold">
                      <Plus size={14} /> Добавить
                    </button>
                  )}
                </div>

                {characters.length === 0 && !isAddingChar && (
                  <p className="text-sm text-slate-500 italic">ИИ придумает персонажей сам. Добавь своих, чтобы уточнить внешность.</p>
                )}

                <div className="space-y-3">
                  {characters.map((char) => (
                    <div key={char.id} className="bg-slate-900/50 p-3 rounded-lg border border-slate-700 flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        {char.referenceImageData ? (
                            <img src={char.referenceImageData} className="w-10 h-10 rounded-full object-cover border border-slate-600" alt={char.name} />
                        ) : (
                            <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-slate-500">
                                <Users size={16} />
                            </div>
                        )}
                        <div>
                            <div className="font-bold text-indigo-300">{char.name}</div>
                            <div className="text-slate-400 text-xs truncate max-w-[200px]">{char.description}</div>
                        </div>
                      </div>
                      <button onClick={() => removeCharacter(char.id)} className="text-slate-500 hover:text-red-400"><X size={16} /></button>
                    </div>
                  ))}

                  {isAddingChar && (
                    <div className="bg-slate-900 p-4 rounded-xl border border-indigo-500/30 space-y-3 animate-fade-in">
                       <input 
                          value={newCharName}
                          onChange={(e) => setNewCharName(e.target.value)}
                          placeholder="Имя"
                          className="w-full bg-slate-800 p-2 rounded border border-slate-700 focus:border-indigo-500 outline-none text-sm"
                       />
                       <input 
                          value={newCharDesc}
                          onChange={(e) => setNewCharDesc(e.target.value)}
                          placeholder="Описание внешности"
                          className="w-full bg-slate-800 p-2 rounded border border-slate-700 focus:border-indigo-500 outline-none text-sm"
                       />
                       
                       {/* Image Upload */}
                       <div className="flex items-center gap-2">
                           <button 
                                onClick={() => fileInputRef.current?.click()}
                                className="flex items-center gap-2 px-3 py-1 bg-slate-800 hover:bg-slate-700 rounded text-xs text-slate-300 border border-slate-600 transition"
                           >
                               <Upload size={14} /> 
                               {newCharImg ? 'Фото загружено (Изменить)' : 'Загрузить фото (Референс)'}
                           </button>
                           <input 
                                type="file" 
                                ref={fileInputRef} 
                                className="hidden" 
                                accept="image/*"
                                onChange={handleImageUpload}
                           />
                           {newCharImg && <img src={newCharImg} className="w-8 h-8 rounded object-cover" alt="Preview" />}
                       </div>

                       <div className="flex justify-end gap-2 pt-2">
                          <button onClick={() => setIsAddingChar(false)} className="px-3 py-1 text-sm text-slate-400 hover:text-white">Отмена</button>
                          <button onClick={addCharacter} className="px-3 py-1 bg-indigo-600 rounded text-sm font-bold hover:bg-indigo-500">Сохранить</button>
                       </div>
                    </div>
                  )}
                </div>
            </div>

            <div className="flex justify-center pt-4">
                <Button onClick={handleGenerate} disabled={!prompt.trim()} className="w-full md:w-auto text-lg px-12">
                    <Sparkles size={20} />
                    Создать Фильм
                </Button>
            </div>
          </div>
        )}

        {/* LOADING STATE */}
        {genState.status === 'generating' && (
             <div className="flex flex-col items-center justify-center mt-20 space-y-6 animate-pulse">
                <div className="relative">
                    <div className="absolute inset-0 bg-indigo-500 blur-xl opacity-20 rounded-full"></div>
                    <Video size={64} className="text-indigo-400 relative z-10" />
                </div>
                <h3 className="text-2xl font-bold text-white">Производство...</h3>
                <div className="flex flex-col gap-2 text-center text-slate-400 max-w-sm">
                    <p>Пишем сценарий ({sceneCount} сцен)...</p>
                    {mode === 'image' && <p>Рисуем кадры в стиле {style}...</p>}
                    {audioMode === 'gemini' && <p>Озвучиваем диалоги (Gemini TTS)...</p>}
                </div>
             </div>
        )}

        {/* ERROR STATE */}
        {genState.status === 'error' && (
            <div className="text-center mt-20 bg-red-500/10 border border-red-500/20 p-8 rounded-2xl max-w-lg">
                <h3 className="text-xl font-bold text-red-400 mb-2">Ошибка</h3>
                <p className="text-slate-300 mb-6">{genState.error}</p>
                <Button variant="secondary" onClick={() => setGenState({ status: 'idle' })}>
                    Попробовать снова
                </Button>
            </div>
        )}

        {/* PLAYING / EDITING STATE */}
        {movie && genState.status !== 'generating' && genState.status !== 'error' && (
             <div className="w-full animate-fade-in-up flex flex-col items-center">
                 
                 {/* Mode Toggles */}
                 <div className="flex flex-wrap justify-center gap-2 mb-6 bg-slate-800 p-1 rounded-lg border border-slate-700">
                    <button 
                      onClick={() => setGenState(prev => ({ ...prev, status: 'playing' }))}
                      className={`flex items-center gap-2 px-4 py-2 rounded-md transition ${genState.status === 'playing' || genState.status === 'finished' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                    >
                       <PlayCircle size={18} /> Смотреть
                    </button>
                    <button 
                      onClick={() => setGenState(prev => ({ ...prev, status: 'editing' }))}
                      className={`flex items-center gap-2 px-4 py-2 rounded-md transition ${genState.status === 'editing' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                    >
                       <Edit size={18} /> Редактор
                    </button>
                    <button 
                      onClick={isRecording ? stopRecording : startRecording}
                      className={`flex items-center gap-2 px-4 py-2 rounded-md transition ${isRecording ? 'bg-red-600 text-white animate-pulse' : 'text-slate-400 hover:text-white'}`}
                    >
                       <Download size={18} /> {isRecording ? 'Стоп' : 'Скачать'}
                    </button>
                 </div>

                 {genState.status === 'editing' ? (
                   <SceneEditor 
                      movie={movie} 
                      onUpdateMovie={updateMovie} 
                      onClose={() => setGenState(prev => ({ ...prev, status: 'playing' }))} 
                   />
                 ) : (
                   <MovieScreen movie={movie} voices={voiceMap} onFinish={handleFinish} />
                 )}
                 
                 {genState.status !== 'editing' && (
                    <div className="mt-8 max-w-4xl w-full mx-auto bg-slate-900/50 p-6 rounded-xl border border-white/5">
                        <h3 className="text-lg font-bold text-slate-300 mb-2">Сюжет</h3>
                        <p className="text-slate-400 leading-relaxed">{movie.summary}</p>
                    </div>
                 )}
             </div>
        )}

      </main>

      <footer className="py-6 text-center text-slate-600 text-sm">
        Создано с помощью Google Gemini API & React
      </footer>

      <style>{`
        @keyframes fade-in {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
            animation: fade-in 0.6s ease-out forwards;
        }
        .animate-fade-in-up {
            animation: fade-in 0.8s ease-out forwards;
        }
      `}</style>
    </div>
  );
}