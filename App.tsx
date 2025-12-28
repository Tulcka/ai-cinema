import React, { useState, useRef } from 'react';
import { generateMovie, generateMovieFromAudio, assignVoices } from './services/geminiService';
import { Movie, GenerationState, VisualStyle, CharacterConfig, SceneCount, AudioMode, AspectRatio } from './types';
import { MovieScreen } from './components/MovieScreen';
import { SceneEditor } from './components/SceneEditor';
import { Button } from './components/Button';
import { Sparkles, Video, Clapperboard, Palette, Users, Plus, X, Edit, PlayCircle, Download, Upload, Mic, Music, FileAudio, Monitor, Smartphone, Square, FileText } from 'lucide-react';

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

const RATIOS: { id: AspectRatio; label: string; icon: React.ReactNode }[] = [
    { id: '16:9', label: 'Landscape', icon: <Monitor size={16} /> },
    { id: '9:16', label: 'Stories', icon: <Smartphone size={16} /> },
    { id: '1:1', label: 'Square', icon: <Square size={16} /> },
    { id: '4:5', label: 'Vertical (4:5)', icon: <Smartphone size={14} /> },
    { id: '21:9', label: 'Cinema', icon: <Monitor size={14} /> },
];

type InputMode = 'text' | 'audio';

export default function App() {
  const [inputMode, setInputMode] = useState<InputMode>('text');
  
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState<VisualStyle>('flat');
  const [audioMode, setAudioMode] = useState<AudioMode>('gemini'); 
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('16:9');
  const [sceneCount, setSceneCount] = useState<SceneCount>(3);
  
  // Custom Audio State
  const [customAudioFile, setCustomAudioFile] = useState<File | null>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

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

  const handleAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          setCustomAudioFile(file);
      }
  };

  const handleGenerate = async () => {
    setGenState({ status: 'generating' });
    try {
      let generatedMovie: Movie;
      
      if (inputMode === 'audio') {
          if (!customAudioFile) {
              setGenState({ status: 'error', error: 'Пожалуйста, выберите аудиофайл.' });
              return;
          }

          // Convert audio to base64
          const reader = new FileReader();
          reader.readAsDataURL(customAudioFile);
          await new Promise(resolve => reader.onload = resolve);
          const base64Audio = (reader.result as string).split(',')[1];
          
          generatedMovie = await generateMovieFromAudio(base64Audio, style, aspectRatio, characters);
          generatedMovie.title = customAudioFile.name.replace(/\.[^/.]+$/, ""); // Use filename as title
      } else {
          // Text Mode
          if (!prompt.trim()) {
              setGenState({ status: 'error', error: 'Пожалуйста, введите описание сюжета.' });
              return;
          }
          generatedMovie = await generateMovie(prompt, style, sceneCount, audioMode, aspectRatio, characters);
      }

      const assignedVoices = assignVoices(generatedMovie, characters);
      
      setMovie(generatedMovie);
      setVoiceMap(assignedVoices);
      setGenState({ status: 'playing' });
    } catch (error) {
      console.error(error);
      setGenState({ status: 'error', error: 'Не удалось создать фильм. Проверьте подключение к API или попробуйте другой файл.' });
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
            
            stream.getTracks().forEach(track => track.stop());
        };
        
        recorder.start();
        setIsRecording(true);
        mediaRecorderRef.current = recorder;
    } catch (e) {
        console.error("Recording failed", e);
        if (e instanceof Error && e.name === 'NotAllowedError') return; 
        alert("Запись недоступна.");
    }
  };

  const stopRecording = () => {
      mediaRecorderRef.current?.stop();
  };

  const isGenerateDisabled = () => {
      if (inputMode === 'audio') return !customAudioFile;
      return !prompt.trim();
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
                onClick={() => { setMovie(null); setGenState({ status: 'idle' }); setPrompt(''); setCharacters([]); setCustomAudioFile(null); }}
                className="text-sm text-slate-400 hover:text-white transition"
             >
                Новый Проект
             </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-8 flex flex-col items-center">
        
        {/* INPUT CONFIGURATION STATE */}
        {!movie && genState.status !== 'generating' && (
          <div className="w-full max-w-3xl mt-6 animate-fade-in space-y-8 pb-20">
            
            {/* Mode Switcher */}
            <div className="flex justify-center mb-8">
                <div className="bg-slate-800 p-1.5 rounded-2xl flex border border-slate-700 shadow-xl">
                    <button 
                        onClick={() => setInputMode('text')}
                        className={`flex items-center gap-2 px-8 py-3 rounded-xl font-bold transition-all ${inputMode === 'text' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                    >
                        <FileText size={20} /> Текст → Фильм
                    </button>
                    <button 
                        onClick={() => setInputMode('audio')}
                        className={`flex items-center gap-2 px-8 py-3 rounded-xl font-bold transition-all ${inputMode === 'audio' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}
                    >
                        <FileAudio size={20} /> Аудио → Клип
                    </button>
                </div>
            </div>

            <div className="text-center mb-8">
                <h2 className="text-4xl font-extrabold mb-4 bg-clip-text text-transparent bg-gradient-to-r from-indigo-300 via-white to-purple-300">
                    {inputMode === 'text' ? 'Сам себе режиссер' : 'Оживи свой звук'}
                </h2>
                <p className="text-slate-400 text-lg">
                   {inputMode === 'text' 
                    ? 'ИИ напишет сценарий, озвучит и нарисует его' 
                    : 'Загрузи трек или подкаст, ИИ создаст видеоряд'}
                </p>
            </div>

            {/* 1. PRIMARY INPUT (Text or Audio) */}
            <div className="bg-slate-800/50 p-6 rounded-2xl border border-white/10 shadow-lg relative">
                <label className="block text-sm font-bold text-slate-300 mb-3 uppercase tracking-wider">
                    {inputMode === 'text' ? 'Сюжет фильма' : 'Аудиофайл'}
                </label>

                {inputMode === 'audio' ? (
                    <div 
                        className={`border-2 border-dashed rounded-xl p-10 text-center transition cursor-pointer group ${customAudioFile ? 'border-green-500/50 bg-green-500/10' : 'border-indigo-500/50 bg-indigo-500/10 hover:border-indigo-400'}`}
                        onClick={() => audioInputRef.current?.click()}
                    >
                        <input 
                           type="file" 
                           ref={audioInputRef} 
                           className="hidden" 
                           accept="audio/mpeg, audio/wav, audio/mp3"
                           onChange={handleAudioUpload}
                        />
                        
                        {customAudioFile ? (
                            <div className="animate-fade-in">
                                <Music size={48} className="mx-auto text-green-400 mb-4" />
                                <p className="text-xl font-bold text-white mb-1">{customAudioFile.name}</p>
                                <p className="text-green-300/70 text-sm">Файл готов к обработке</p>
                                <button 
                                    onClick={(e) => { e.stopPropagation(); setCustomAudioFile(null); }}
                                    className="mt-4 text-sm text-red-400 hover:text-white underline"
                                >
                                    Удалить
                                </button>
                            </div>
                        ) : (
                            <div>
                                <Upload size={48} className="mx-auto text-indigo-400 mb-4 group-hover:scale-110 transition-transform" />
                                <p className="text-lg font-bold text-white mb-2">Нажми, чтобы загрузить</p>
                                <p className="text-slate-400 text-sm">MP3 или WAV (до 10 МБ)</p>
                            </div>
                        )}
                    </div>
                ) : (
                    <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="Опиши сюжет: Шерлок Холмс и Доктор Ватсон пьют чай в космосе..."
                        className="w-full bg-slate-900/50 text-white p-4 text-lg rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none min-h-[120px] placeholder:text-slate-600 border border-transparent transition-all focus:bg-slate-900"
                    />
                )}
            </div>

            {/* 2. SETTINGS */}
            <div className="bg-slate-800/50 p-6 rounded-2xl border border-white/10 shadow-lg">
                <div className="flex justify-between items-center mb-6">
                     <label className="flex items-center gap-2 text-sm font-bold text-slate-300 uppercase tracking-wider">
                        <Palette size={16} /> Настройки Визуализации
                     </label>
                </div>
                
                <div className="flex flex-wrap gap-4 mb-6">
                    {/* Aspect Ratio */}
                    <div className="bg-slate-900 p-1 rounded-lg inline-flex border border-slate-700 items-center px-3 gap-2">
                        <span className="text-xs text-slate-400 uppercase font-bold">Формат:</span>
                        <select 
                            value={aspectRatio} 
                            onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
                            className="bg-transparent text-white font-bold outline-none text-sm cursor-pointer"
                        >
                            {RATIOS.map(r => (
                                <option key={r.id} value={r.id}>{r.id} ({r.label})</option>
                            ))}
                        </select>
                    </div>

                     {/* Audio Mode Specifics: Scene count only for Text mode */}
                     {inputMode === 'text' && (
                        <div className="bg-slate-900 p-1 rounded-lg inline-flex border border-slate-700 items-center px-3 gap-2">
                            <span className="text-xs text-slate-400 uppercase font-bold">Длина:</span>
                            <select 
                                value={sceneCount} 
                                onChange={(e) => setSceneCount(Number(e.target.value) as SceneCount)}
                                className="bg-transparent text-white font-bold outline-none text-sm cursor-pointer"
                            >
                                <option value={3}>Короткий (3 сцены)</option>
                                <option value={5}>Средний (5 сцен)</option>
                                <option value={8}>Длинный (8 сцен)</option>
                            </select>
                        </div>
                     )}

                     {/* Text Mode Specifics: Audio Source */}
                     {inputMode === 'text' && (
                        <div className="bg-slate-900 p-1 rounded-lg inline-flex border border-slate-700">
                             <button onClick={() => setAudioMode('gemini')} className={`px-3 py-2 rounded flex items-center gap-2 text-xs font-bold transition ${audioMode === 'gemini' ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>
                                <Music size={14} /> AI Voices
                            </button>
                            <button onClick={() => setAudioMode('browser')} className={`px-3 py-2 rounded flex items-center gap-2 text-xs font-bold transition ${audioMode === 'browser' ? 'bg-green-600 text-white' : 'text-slate-400'}`}>
                                <Mic size={14} /> Browser TTS
                            </button>
                        </div>
                     )}
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

            {/* 3. Characters (Universal) */}
            <div className="bg-slate-800/50 p-6 rounded-2xl border border-white/10 shadow-lg">
                <div className="flex justify-between items-center mb-4">
                  <label className="flex items-center gap-2 text-sm font-bold text-slate-300 uppercase tracking-wider">
                    <Users size={16} /> Персонажи (Опционально)
                  </label>
                  {!isAddingChar && (
                    <button onClick={() => setIsAddingChar(true)} className="text-xs flex items-center gap-1 text-indigo-400 hover:text-indigo-300 font-bold">
                      <Plus size={14} /> Добавить
                    </button>
                  )}
                </div>

                {characters.length === 0 && !isAddingChar && (
                  <p className="text-sm text-slate-500 italic">
                      {inputMode === 'text' 
                        ? 'ИИ придумает персонажей сам. Добавьте своих для точности.' 
                        : 'Если в аудио есть конкретные люди, опишите их здесь, чтобы ИИ нарисовал их.'}
                  </p>
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
                       
                       <div className="flex items-center gap-2">
                           <button 
                                onClick={() => fileInputRef.current?.click()}
                                className="flex items-center gap-2 px-3 py-1 bg-slate-800 hover:bg-slate-700 rounded text-xs text-slate-300 border border-slate-600 transition"
                           >
                               <Upload size={14} /> 
                               {newCharImg ? 'Фото загружено' : 'Загрузить фото'}
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
                <Button onClick={handleGenerate} disabled={isGenerateDisabled()} className="w-full md:w-auto text-lg px-12 py-4">
                    <Sparkles size={20} />
                    {inputMode === 'text' ? 'Создать Фильм' : 'Визуализировать Аудио'}
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
                <h3 className="text-2xl font-bold text-white">
                    {inputMode === 'text' ? 'Пишем сценарий...' : 'Слушаем аудио...'}
                </h3>
                <div className="flex flex-col gap-2 text-center text-slate-400 max-w-sm">
                    {inputMode === 'audio' ? (
                        <>
                            <p>Анализируем звуковую дорожку...</p>
                            <p>Разбиваем на сцены по смыслу...</p>
                            <p>Генерируем кадры...</p>
                        </>
                    ) : (
                        <>
                            <p>Генерируем сюжет...</p>
                            <p>Рисуем сцены...</p>
                            <p>Озвучиваем персонажей...</p>
                        </>
                    )}
                </div>
             </div>
        )}

        {/* ERROR STATE */}
        {genState.status === 'error' && (
            <div className="text-center mt-20 bg-red-500/10 border border-red-500/20 p-8 rounded-2xl max-w-lg">
                <h3 className="text-xl font-bold text-red-400 mb-2">Ошибка</h3>
                <p className="text-slate-300 mb-6">{genState.error}</p>
                <Button variant="secondary" onClick={() => setGenState({ status: 'idle' })}>
                    Назад
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
                    {/* Editing disabled for custom audio mode for simplicity */}
                    {inputMode === 'text' && (
                        <button 
                          onClick={() => setGenState(prev => ({ ...prev, status: 'editing' }))}
                          className={`flex items-center gap-2 px-4 py-2 rounded-md transition ${genState.status === 'editing' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                        >
                           <Edit size={18} /> Редактор
                        </button>
                    )}
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
                 
                 {genState.status !== 'editing' && movie.summary && (
                    <div className="mt-8 max-w-4xl w-full mx-auto bg-slate-900/50 p-6 rounded-xl border border-white/5">
                        <h3 className="text-lg font-bold text-slate-300 mb-2">Контекст</h3>
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