import { GoogleGenAI, Type, Schema, Modality } from "@google/genai";
import { Movie, VisualStyle, CharacterConfig, Scene, GenerationMode, SceneCount, AudioMode } from "../types";

const genAI = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Voices
const MALE_VOICES = ['Puck', 'Charon', 'Fenrir'];
const FEMALE_VOICES = ['Kore', 'Zephyr'];
const NARRATOR_VOICE = 'Fenrir'; 

const movieSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: "Название фильма на русском" },
    summary: { type: Type.STRING, description: "Краткое описание сюжета на русском" },
    scenes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          duration: { type: Type.NUMBER },
          backgroundColor: { type: Type.STRING },
          backgroundSvg: { type: Type.STRING, description: "SVG контент фона (без внешнего тега svg). Используй <g>, <rect>, <circle>, <path> чтобы нарисовать детали окружения (деревья, дома, мебель). МИНИМУМ 10-20 фигур." },
          description: { type: Type.STRING, description: "ПОЛНОЕ визуальное описание сцены." },
          characters: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                name: { type: Type.STRING },
                svgBody: { type: Type.STRING, description: "SVG контент персонажа. ОБЯЗАТЕЛЬНО нарисуй: Голова, Тело, Руки/Ноги. Используй комбинацию простых фигур." },
                x: { type: Type.NUMBER },
                y: { type: Type.NUMBER },
                scale: { type: Type.NUMBER },
                animation: { type: Type.STRING, enum: ['idle', 'float', 'bounce', 'shake', 'walk', 'pulse', 'stretch', 'wobble'] }
              },
              required: ["id", "name", "svgBody", "x", "y", "scale", "animation"]
            }
          },
          script: {
            type: Type.ARRAY,
            description: "Диалог персонажей. Минимум 2-4 реплики.",
            items: {
              type: Type.OBJECT,
              properties: {
                characterId: { type: Type.STRING },
                text: { type: Type.STRING }
              },
              required: ["characterId", "text"]
            }
          }
        },
        required: ["id", "duration", "backgroundColor", "backgroundSvg", "characters", "description", "script"]
      }
    }
  },
  required: ["title", "summary", "scenes"]
};

const getStyleInstructions = (style: VisualStyle): string => {
  const prefix = "СТРОГО ПРИДЕРЖИВАЙСЯ СТИЛЯ:";
  switch (style) {
    case 'cartoon-3d': return `${prefix} 3D Pixar style, объемное освещение, яркие цвета.`;
    case 'cinematic': return `${prefix} Кинематографичный реализм, драматичное освещение.`;
    case 'hand-drawn': return `${prefix} Скетч от руки, небрежные линии.`;
    case 'pixel-art': return `${prefix} Pixel Art, блочные формы.`;
    case 'anime': return `${prefix} Аниме стиль.`;
    case 'noir': return `${prefix} Нуар, высокий контраст.`;
    case 'cyberpunk': return `${prefix} Киберпанк, неон, геометрия.`;
    case 'watercolor': return `${prefix} Акварель.`;
    case 'retro-game': return `${prefix} 8-bit games.`;
    case 'flat':
    default: return `${prefix} Flat Design, векторный минимализм.`;
  }
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const generateSpeech = async (text: string, voiceName: string): Promise<string | undefined> => {
  const maxRetries = 3;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await genAI.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voiceName || 'Puck' },
            },
          },
        },
      });
      return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    } catch (e: any) {
      if (e.message?.includes('429') || e.status === 429) {
        await delay((i + 1) * 1500);
        continue;
      }
      return undefined;
    }
  }
  return undefined;
};

// Updated Image Generator to accept Reference Images
const generateImage = async (prompt: string, referenceImages: string[] = []): Promise<string | undefined> => {
    try {
        const parts: any[] = [{ text: prompt }];
        
        if (referenceImages.length > 0) {
           parts.push({ 
             inlineData: { 
               mimeType: 'image/jpeg', 
               data: referenceImages[0].split(',')[1] 
             } 
           });
           parts.push({ text: "Use this image as a strict visual reference for the character/style in the scene." });
        }

        const response = await genAI.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: { parts }
        });

        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) {
                return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
            }
        }
    } catch (e) {
        console.error("Image generation failed", e);
    }
    return undefined;
};

export const generateMovie = async (
  prompt: string, 
  style: VisualStyle, 
  mode: GenerationMode, 
  sceneCount: SceneCount,
  audioMode: AudioMode,
  characterConfigs: CharacterConfig[]
): Promise<Movie> => {
  const styleInstruction = getStyleInstructions(style);
  
  let characterContext = "";
  if (characterConfigs.length > 0) {
    characterContext = `
    ИСПОЛЬЗУЙ ЭТИХ ПЕРСОНАЖЕЙ (включи их в массив characters в сценах):
    ${characterConfigs.map(c => `- ID: ${c.id}, Имя: ${c.name}, Описание: ${c.description}`).join('\n')}
    `;
  }

  const svgInstruction = mode === 'svg' ? `
    РЕЖИМ ГЕНЕРАЦИИ SVG (ART MODE):
    1. Ты - векторный художник. Твоя задача - рисовать детальные сцены кодом.
    2. ФОН (backgroundSvg): НЕ оставляй его пустым. Рисуй окружение используя множество фигур (<rect>, <circle>, <path>). Если это лес - нарисуй деревья из треугольников и прямоугольников. Если комната - нарисуй окна, двери, мебель.
    3. ПЕРСОНАЖИ (svgBody): ОБЯЗАТЕЛЬНО рисуй персонажей. Собери их из примитивов (круг-голова, прямоугольник-тело, линии-руки). НЕ используй внешние картинки, только SVG код внутри <g>.
    4. СЛОЖНОСТЬ: Не бойся использовать много тегов. Если нужно создать сложный объект - собери его из 10-20 мелких простых фигур (пиксель-арт или геометрическая аппликация).
    5. Используй <path d="..."> для более сложных форм, но держи координаты в разумных пределах (viewBox 0 0 100 100).
  ` : '';

  // 1. Script Generation
  const response = await genAI.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Создай полный сценарий анимационного фильма в формате JSON.
    Запрос: "${prompt}".
    Количество сцен: ${sceneCount}.
    Стиль: ${styleInstruction}.
    
    ${svgInstruction}
    ${characterContext}
    
    ВАЖНО ПО ДИАЛОГАМ:
    - В каждой сцене персонажи должны РАЗГОВАРИВАТЬ.
    - Массив 'script' должен содержать МИНИМУМ 3-4 реплики для каждой сцены (кроме чисто пейзажных сцен).
    - Диалоги должны развивать сюжет.
    
    Язык: Русский.
    `,
    config: {
      responseMimeType: "application/json",
      responseSchema: movieSchema,
      systemInstruction: "Ты профессиональный режиссер и SVG-художник. Ты создаешь насыщенные визуально и сюжетно истории."
    }
  });

  const text = response.text;
  if (!text) throw new Error("AI Empty Response");
  
  const movieData = JSON.parse(text) as Movie;
  movieData.style = style;
  movieData.mode = mode;
  movieData.audioMode = audioMode;

  // 2. Visual Generation (Only for Image Mode)
  if (mode === 'image') {
      const allRefs = characterConfigs
        .filter(c => c.referenceImageData)
        .map(c => c.referenceImageData!);

      for (const scene of movieData.scenes) {
          const scenePrompt = `${styleInstruction} Full scene illustration. ${scene.description}. Cinematic composition.`;
          const bgImage = await generateImage(scenePrompt, allRefs.length > 0 ? [allRefs[0]] : []);
          if (bgImage) scene.backgroundImageUrl = bgImage;
          
          // Clear SVG data in image mode to avoid confusion
          scene.backgroundSvg = undefined;
          scene.characters.forEach(c => c.svgBody = undefined);
      }
  }

  return movieData;
};

export const generateSceneFromPrompt = async (prompt: string, currentMovie: Movie): Promise<Scene> => {
    const sceneSchema: Schema = movieSchema.properties!.scenes!.items as Schema;
    
    const svgHint = currentMovie.mode === 'svg' 
        ? "РЕЖИМ SVG: Рисуй детализированный backgroundSvg и svgBody для персонажей используя множество примитивов (<rect>, <circle>). Не оставляй пустоты." 
        : "";

    const sceneResponse = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Сгенерируй ОДНУ сцену с диалогом (минимум 3 реплики). Контекст: ${currentMovie.title}. Стиль: ${currentMovie.style}. Запрос: "${prompt}". ${svgHint}`,
        config: { responseMimeType: "application/json", responseSchema: sceneSchema }
    });

    const text = sceneResponse.text;
    if(!text) throw new Error("Failed");
    const scene = JSON.parse(text) as Scene;

    if (currentMovie.mode === 'image') {
         const bgImage = await generateImage(`${currentMovie.style} Full scene: ${scene.description}`);
         if (bgImage) scene.backgroundImageUrl = bgImage;
    }
    return scene;
}

export const assignVoices = (movie: Movie, configs: CharacterConfig[]) => {
    const charMap = new Map<string, string>();
    configs.forEach(c => { if(c.voice) charMap.set(c.id, c.voice); });

    const guessVoice = (name: string): string => {
        if (!name) return MALE_VOICES[0];
        const lower = name.toLowerCase();
        if (lower.endsWith('а') || lower.endsWith('я') || lower.endsWith('a') || lower.endsWith('ya')) {
            return FEMALE_VOICES[Math.floor(Math.random() * FEMALE_VOICES.length)];
        }
        return MALE_VOICES[Math.floor(Math.random() * MALE_VOICES.length)];
    };

    movie.scenes.forEach(s => {
        s.characters.forEach(c => {
            if (charMap.has(c.id)) return;
            const voice = guessVoice(c.name);
            charMap.set(c.id, voice);
        });
    });
    charMap.set('narrator', NARRATOR_VOICE);
    return charMap;
};