import React, { useState } from 'react';
import { Movie, Scene } from '../types';
import { Trash2, ArrowUp, ArrowDown, Clock, Plus, Sparkles, X } from 'lucide-react';
import { generateSceneFromPrompt } from '../services/geminiService';
import { Button } from './Button';

interface SceneEditorProps {
  movie: Movie;
  onUpdateMovie: (movie: Movie) => void;
  onClose: () => void;
}

export const SceneEditor: React.FC<SceneEditorProps> = ({ movie, onUpdateMovie, onClose }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);

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
        {movie.scenes.map((scene, index) => (
          <div key={scene.id || index} className="bg-slate-800 p-4 rounded-xl border border-slate-700 flex items-center gap-4 hover:border-indigo-500/50 transition-colors">
            
            {/* Scene Preview (Mini) */}
            <div className="w-24 h-16 bg-black rounded-lg overflow-hidden relative shrink-0 border border-slate-600">
               {movie.mode === 'image' && scene.backgroundImageUrl ? (
                   <img src={scene.backgroundImageUrl} className="w-full h-full object-cover" alt="scene" />
               ) : (
                   <svg viewBox="0 0 100 100" className="w-full h-full" style={{ backgroundColor: scene.backgroundColor }}>
                      <g dangerouslySetInnerHTML={{ __html: scene.backgroundSvg || '' }} />
                      {/* Only show svg characters in SVG mode */}
                      {movie.mode === 'svg' && scene.characters.map((c, i) => (
                         <g key={i} transform={`translate(${c.x}, ${c.y}) scale(0.5)`}>
                            <g dangerouslySetInnerHTML={{ __html: c.svgBody || '' }} />
                         </g>
                      ))}
                   </svg>
               )}
               <div className="absolute top-0 left-0 bg-black/60 text-white text-[10px] px-1">
                 #{index + 1}
               </div>
            </div>

            {/* Controls */}
            <div className="flex-1 min-w-0">
               <p className="text-sm text-slate-300 truncate font-medium">{scene.description}</p>
               <p className="text-xs text-slate-500 mt-1">Реплик: {scene.script.length}</p>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
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
        ))}
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