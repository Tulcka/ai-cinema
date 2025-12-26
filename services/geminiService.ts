import { GoogleGenAI, Type, Schema, Modality } from "@google/genai";
import { Movie, VisualStyle, CharacterConfig, Scene, DialogueLine, GenerationMode, Character } from "../types";

const genAI = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Voices
const MALE_VOICES = ['Puck', 'Charon', 'Fenrir'];
const FEMALE_VOICES = ['Kore', 'Zephyr'];
const NARRATOR_VOICE = 'Fenrir'; // Deep voice for narration

const movieSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: "Название фильма на русском" },
    summary: { type: Type.STRING, description: "Краткое описание сюжета на русском" },
    style: { type: Type.STRING },
    scenes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          duration: { type: Type.NUMBER, description: "Примерная длительность в секундах" },
          backgroundColor: { type: Type.STRING },
          backgroundSvg: { type: Type.STRING, description: "SVG элементы фона (без тега svg)" },
          description: { type: Type.STRING, description: "Визуальное описание сцены ВКЛЮЧАЯ персонажей и их действия." },
          characters: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                name: { type: Type.STRING },
                svgBody: { type: Type.STRING, description: "SVG элементы персонажа (только для SVG режима)" },
                x: { type: Type.NUMBER },
                y: { type: Type.NUMBER },
                scale: { type: Type.NUMBER },
                animation: { type: Type.STRING, enum: ['idle', 'float', 'bounce', 'shake', 'walk', 'pulse', 'stretch', 'wobble'] }
              },
              required: ["id", "name", "x", "y", "scale", "animation"]
            }
          },
          script: {
            type: Type.ARRAY,
            description: "Последовательность реплик в этой сцене.",
            items: {
              type: Type.OBJECT,
              properties: {
                characterId: { type: Type.STRING },
                text: { type: Type.STRING, description: "Текст реплики на русском" }
              },
              required: ["characterId", "text"]
            }
          }
        },
        required: ["id", "duration", "backgroundColor", "characters", "description", "script"]
      }
    }
  },
  required: ["title", "summary", "scenes"]
};

const getStyleInstructions = (style: VisualStyle): string => {
  switch (style) {
    case 'cartoon-3d':
      return "Стиль: 3D мультфильм, объемный, яркий.";
    case 'cinematic':
      return "Стиль: Кинематографичный, реалистичное освещение, детализация.";
    case 'hand-drawn':
      return "Стиль: Рисованный от руки, скетч.";
    case 'pixel-art':
      return "Стиль: Пиксель арт.";
    case 'flat':
    default:
      return "Стиль: Векторная графика, плоский дизайн.";
  }
};

// Helper for delays
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const generateSpeech = async (text: string, voiceName: string): Promise<string | undefined> => {
  // Simple retry logic for 429 errors
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
        console.warn(`TTS Rate limit hit. Retrying in ${(i + 1) * 1000}ms...`);
        await delay((i + 1) * 1500); // Wait longer each time
        continue;
      }
      console.error("TTS generation failed", e);
      return undefined; // Give up if not rate limit or max retries reached
    }
  }
  return undefined;
};

// Generate an image using "Nano Banana" (gemini-2.5-flash-image)
const generateImage = async (prompt: string): Promise<string | undefined> => {
    try {
        const response = await genAI.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: {
                parts: [{ text: prompt }]
            }
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

export const generateMovie = async (prompt: string, style: VisualStyle, mode: GenerationMode, characterConfigs: CharacterConfig[]): Promise<Movie> => {
  const styleInstruction = getStyleInstructions(style);
  
  let characterContext = "";
  if (characterConfigs.length > 0) {
    characterContext = `
    ОБЯЗАТЕЛЬНО используй этих персонажей (сохраняй их ID):
    ${characterConfigs.map(c => `- ID: ${c.id}, Имя: ${c.name}, Описание: ${c.description}`).join('\n')}
    `;
  }

  // 1. Generate Script and Structure
  const response = await genAI.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Создай короткий анимационный фильм на русском языке. Запрос: "${prompt}".
    
    Режим генерации: ${mode === 'image' ? 'Используем генерацию картинок (Nano Banana).' : 'Используем SVG.'}
    ${styleInstruction}
    ${characterContext}

    Требования:
    1. Разбей историю на 3-5 сцен.
    2. Поле 'description' должно содержать ПОЛНОЕ описание кадра, включая персонажей, их позы и эмоции, так как спрайты накладываться не будут (для режима image).
    3. Персонажи:
       - Если режим 'image': поле 'svgBody' оставь пустым. Персонажи будут нарисованы прямо в фоне.
       - Если режим 'svg': заполни 'svgBody'.
    4. Язык JSON: Русский.
    `,
    config: {
      responseMimeType: "application/json",
      responseSchema: movieSchema,
      systemInstruction: "Ты режиссер анимации."
    }
  });

  const text = response.text;
  if (!text) throw new Error("Нет ответа от ИИ");
  
  const movieData = JSON.parse(text) as Movie;
  movieData.style = style;
  movieData.mode = mode;

  // 2. If Image Mode, generate ONE image per scene (Characters baked in)
  if (mode === 'image') {
      for (const scene of movieData.scenes) {
          // Generate full scene with characters
          const scenePrompt = `${styleInstruction} Full scene illustration. ${scene.description}. High quality, detailed.`;
          const bgImage = await generateImage(scenePrompt);
          if (bgImage) scene.backgroundImageUrl = bgImage;
          
          // NOTE: We do NOT generate separate character sprites anymore.
          // We intentionally leave characters[].imageUrl empty.
      }
  }

  return movieData;
};

export const generateSceneFromPrompt = async (prompt: string, currentMovie: Movie): Promise<Scene> => {
    const sceneSchema: Schema = movieSchema.properties!.scenes!.items as Schema;
    const sceneResponse = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Сгенерируй ОДНУ новую сцену. Контекст: ${currentMovie.title}. Стиль: ${currentMovie.style}. Запрос: "${prompt}".`,
        config: { responseMimeType: "application/json", responseSchema: sceneSchema }
    });

    const text = sceneResponse.text;
    if(!text) throw new Error("Failed");
    const scene = JSON.parse(text) as Scene;

    // Generate images if needed
    if (currentMovie.mode === 'image') {
         const bgImage = await generateImage(`${currentMovie.style} Full scene: ${scene.description}`);
         if (bgImage) scene.backgroundImageUrl = bgImage;
    }
    return scene;
}

// Improved Voice Assignment
export const assignVoices = (movie: Movie, configs: CharacterConfig[]) => {
    const charMap = new Map<string, string>();
    
    // 1. Assign from manual configs
    configs.forEach(c => {
        if(c.voice) charMap.set(c.id, c.voice);
    });

    // 2. Helper to guess gender
    const guessVoice = (name: string): string => {
        if (!name) return MALE_VOICES[0];
        const lower = name.toLowerCase();
        // Russian feminine endings heuristic
        if (lower.endsWith('а') || lower.endsWith('я') || lower.endsWith('a') || lower.endsWith('ya')) {
            return FEMALE_VOICES[Math.floor(Math.random() * FEMALE_VOICES.length)];
        }
        return MALE_VOICES[Math.floor(Math.random() * MALE_VOICES.length)];
    };

    // 3. Assign for all movie characters ensuring consistency by ID
    movie.scenes.forEach(s => {
        s.characters.forEach(c => {
            if (charMap.has(c.id)) return;
            const voice = guessVoice(c.name);
            charMap.set(c.id, voice);
        });
    });
    
    // Add Narrator
    charMap.set('narrator', NARRATOR_VOICE);
    
    return charMap;
};