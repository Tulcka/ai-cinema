import { GoogleGenAI, Type, Schema, Modality } from "@google/genai";
import { Movie, VisualStyle, CharacterConfig, Scene, SceneCount, AudioMode, AspectRatio, Character } from "../types";

const genAI = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Voices
const MALE_VOICES = ['Puck', 'Charon', 'Fenrir'];
const FEMALE_VOICES = ['Kore', 'Zephyr'];
const NARRATOR_VOICE = 'Fenrir'; 

// --- HELPERS ---

const safeJsonParse = <T>(text: string): T => {
  if (!text) throw new Error("AI returned empty response");
  let cleanText = text.replace(/```json\n?|```/g, '').trim();
  try {
    return JSON.parse(cleanText) as T;
  } catch (e) {
    console.error("JSON Parse Error. Text snippet:", cleanText.slice(-100));
    if (e instanceof SyntaxError && (e.message.includes("Unterminated string") || e.message.includes("End of data") || e.message.includes("Expected"))) {
       throw new Error("Response was cut off. The story is too long. Try fewer scenes.");
    }
    throw new Error("Failed to parse AI response. " + (e instanceof Error ? e.message : String(e)));
  }
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- SCHEMAS ---

const getNormalizedStorySchema = (isCustomAudio: boolean): Schema => {
  
  const sceneProperties: Record<string, Schema> = {
    id: { type: Type.STRING },
    duration: { type: Type.NUMBER },
    description: { type: Type.STRING, description: "Detailed visual description of the scene. Mention characters by name if they appear." },
    charactersInScene: {
        type: Type.ARRAY,
        description: "List of Character IDs present in this scene.",
        items: { type: Type.STRING }
    }
  };

  const sceneRequired: string[] = ["id", "description", "charactersInScene"];

  if (isCustomAudio) {
      sceneProperties.startTime = { type: Type.NUMBER };
      sceneProperties.endTime = { type: Type.NUMBER };
      sceneRequired.push("startTime", "endTime");
  } else {
      sceneProperties.script = {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              characterId: { type: Type.STRING },
              text: { type: Type.STRING, description: "Dialogue text." }
            },
            required: ["characterId", "text"]
          }
      };
      sceneRequired.push("duration", "script");
  }

  return {
    type: Type.OBJECT,
    properties: {
      title: { type: Type.STRING, description: "Movie title" },
      summary: { type: Type.STRING, description: "Short summary" },
      cast: {
        type: Type.ARRAY,
        description: "List of all characters appearing in the movie.",
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            name: { type: Type.STRING, description: "Name" },
            description: { type: Type.STRING, description: "Visual appearance description." }
          },
          required: ["id", "name", "description"]
        }
      },
      scenes: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: sceneProperties,
          required: sceneRequired
        }
      }
    },
    required: ["title", "summary", "cast", "scenes"]
  };
};

const getStyleInstructions = (style: VisualStyle): string => {
  const prefix = "VISUAL STYLE:";
  switch (style) {
    case 'cartoon-3d': return `${prefix} 3D Pixar style, volume lighting, cute, rendered.`;
    case 'cinematic': return `${prefix} Cinematic movie shot, realistic, dramatic lighting, 8k.`;
    case 'anime': return `${prefix} Anime style, Studio Ghibli inspired, vibrant.`;
    case 'pixel-art': return `${prefix} Pixel Art, 16-bit retro game style.`;
    case 'noir': return `${prefix} Film Noir, black and white, high contrast, moody.`;
    case 'cyberpunk': return `${prefix} Cyberpunk, neon lights, futuristic, night time.`;
    case 'watercolor': return `${prefix} Watercolor painting, soft edges, artistic.`;
    case 'retro-game': return `${prefix} Retro 90s video game style.`;
    case 'flat':
    default: return `${prefix} Flat Design, minimalist vector illustration, clean lines.`;
  }
};

// --- VISUAL GENERATION HELPERS ---

const generateImage = async (prompt: string, aspectRatio: AspectRatio, referenceImages: string[] = []): Promise<string | undefined> => {
    try {
        const parts: any[] = [{ text: prompt }];
        if (referenceImages.length > 0) {
           parts.push({ inlineData: { mimeType: 'image/jpeg', data: referenceImages[0].split(',')[1] } });
           parts.push({ text: "Use this image as a strict character reference." });
        }
        const finalPrompt = `${prompt} Aspect Ratio: ${aspectRatio}`;
        const response = await genAI.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: { parts: [{ text: finalPrompt }] }
        });
        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        }
    } catch (e) {
        console.error("Image generation failed", e);
    }
    return undefined;
};

// --- AUDIO GENERATION HELPERS ---

export const generateSpeech = async (text: string, voiceName: string): Promise<string | undefined> => {
  const maxRetries = 3;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await genAI.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName || 'Puck' } } },
        },
      });
      return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    } catch (e: any) {
      if (e.message?.includes('429') || e.status === 429) {
        await delay((i + 1) * 2000); // Increased backoff
        continue;
      }
      return undefined;
    }
  }
  return undefined;
};

// --- DATA HYDRATION ---

const hydrateMovieFromNormalized = (normalizedData: any, style: VisualStyle, audioMode: AudioMode, aspectRatio: AspectRatio): Movie => {
    const castMap = new Map<string, {name: string, description: string}>();
    if (normalizedData.cast) {
        normalizedData.cast.forEach((c: any) => castMap.set(c.id, { name: c.name, description: c.description }));
    }

    const scenes: Scene[] = normalizedData.scenes.map((s: any) => {
        const charactersInScene: Character[] = (s.charactersInScene || []).map((charId: string) => {
             const castInfo = castMap.get(charId) || { name: 'Unknown', description: '' };
             return {
                 id: charId,
                 name: castInfo.name,
             } as Character;
        });

        return {
            id: s.id,
            startTime: s.startTime,
            endTime: s.endTime,
            duration: s.duration,
            description: s.description,
            characters: charactersInScene,
            script: s.script || []
        } as Scene;
    });

    return {
        title: normalizedData.title,
        summary: normalizedData.summary,
        style,
        audioMode,
        aspectRatio,
        scenes
    };
};

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

// --- ORCHESTRATORS ---

const enrichScenesWithVisuals = async (movie: Movie, characterConfigs: CharacterConfig[]) => {
    const allRefs = characterConfigs.filter(c => c.referenceImageData).map(c => c.referenceImageData!);
    const styleInstruction = getStyleInstructions(movie.style);
    
    const promises = movie.scenes.map(async (scene) => {
        let prompt = `${styleInstruction} Scene: ${scene.description}.`;
        
        if (scene.characters.length > 0) {
             const charsInScene = scene.characters.map(c => {
                 const config = characterConfigs.find(conf => conf.id === c.id);
                 return config ? `${config.name} (${config.description})` : c.name;
             }).join(', ');
             prompt += ` Characters present: ${charsInScene}.`;
        }

        prompt += ` Aspect Ratio ${movie.aspectRatio}. High quality, detailed.`;

        const bgImage = await generateImage(prompt, movie.aspectRatio, allRefs.length > 0 ? [allRefs[0]] : []);
        if (bgImage) scene.backgroundImageUrl = bgImage;
    });

    await Promise.all(promises);
    return movie;
};

// NEW: Pre-generate all audio
const enrichScenesWithAudio = async (movie: Movie, voices: Map<string, string>) => {
    if (movie.audioMode !== 'gemini') return movie;

    // Generate Narration for scenes
    for (const scene of movie.scenes) {
        if (scene.description) {
            const audio = await generateSpeech(scene.description, voices.get('narrator') || 'Fenrir');
            if (audio) scene.narrationAudioData = audio;
        }
        await delay(500); // Rate limit protection
    }

    // Generate Dialogue
    for (const scene of movie.scenes) {
        for (const line of scene.script) {
            const voice = voices.get(line.characterId) || 'Puck';
            const audio = await generateSpeech(line.text, voice);
            if (audio) line.audioData = audio;
            await delay(500); // Rate limit protection
        }
    }
    return movie;
};

// --- EXPORTED FUNCTIONS ---

export const generateMovie = async (
  prompt: string, 
  style: VisualStyle, 
  sceneCount: SceneCount,
  audioMode: AudioMode,
  aspectRatio: AspectRatio,
  characterConfigs: CharacterConfig[]
): Promise<Movie> => {
  const styleInstruction = getStyleInstructions(style);
  
  let characterContext = "";
  if (characterConfigs.length > 0) {
    characterContext = `Include these characters: ${characterConfigs.map(c => `${c.name} (ID: ${c.id}, Desc: ${c.description})`).join(', ')}.`;
  }

  // STEP 1: Generate Structure
  const response = await genAI.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Write a movie script JSON.
    Prompt: "${prompt}".
    Scene Count: ${sceneCount}.
    Style: ${style}. Ratio: ${aspectRatio}.
    ${characterContext}
    
    IMPORTANT RULES:
    1. DETECT THE LANGUAGE of the Prompt. The 'description', 'summary', 'name', and 'text' fields MUST BE in that detected language.
    2. Provide a 'cast' list first, then 'scenes'.
    3. For each scene, provide a 'description' that is extremely visual and detailed.
    4. List characters present in 'charactersInScene'.
    `,
    config: {
      responseMimeType: "application/json",
      responseSchema: getNormalizedStorySchema(false),
      systemInstruction: "You are a multilingual screenwriter. You output strict JSON. You adapt to the language of the user's prompt.",
      maxOutputTokens: 8192
    }
  });

  const normalizedData = safeJsonParse<any>(response.text);
  const movieData = hydrateMovieFromNormalized(normalizedData, style, audioMode, aspectRatio);
  const voices = assignVoices(movieData, characterConfigs);

  // STEP 2: Generate Visuals & Audio Parallel-ish
  // We await visuals first, then audio, to ensure we don't hit rate limits too hard simultaneously
  await enrichScenesWithVisuals(movieData, characterConfigs);
  
  // STEP 3: Generate Audio (if needed)
  if (audioMode === 'gemini') {
      await enrichScenesWithAudio(movieData, voices);
  }

  return movieData;
};

export const generateMovieFromAudio = async (
    audioBase64: string,
    style: VisualStyle,
    aspectRatio: AspectRatio,
    characterConfigs: CharacterConfig[]
): Promise<Movie> => {
    const styleInstruction = getStyleInstructions(style);
    
    // STEP 1: Analysis (Structure)
    const response = await genAI.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
            { inlineData: { mimeType: "audio/mp3", data: audioBase64 } },
            {
                text: `
                Analyze this audio. Split into visual scenes (max 20).
                Style: ${styleInstruction}.
                ${characterConfigs.length > 0 ? 'Detect these characters: ' + characterConfigs.map(c=>c.name).join(', ') : ''}
                
                Return JSON with 'cast' and 'scenes'. 
                DETECT LANGUAGE of the audio. The 'description' and text MUST be in the same language as the audio.
                The 'description' must be a detailed prompt for an image generator.
                `
            }
        ],
        config: {
            responseMimeType: "application/json",
            responseSchema: getNormalizedStorySchema(true),
            systemInstruction: "Video editor assistant. Output strict JSON in the language of the audio.",
            maxOutputTokens: 8192
        }
    });

    const normalizedData = safeJsonParse<any>(response.text);
    const movieData = hydrateMovieFromNormalized(normalizedData, style, 'custom', aspectRatio);
    
    movieData.customAudioData = audioBase64;

    // STEP 2: Visuals
    return await enrichScenesWithVisuals(movieData, characterConfigs);
}

export const generateSceneFromPrompt = async (prompt: string, currentMovie: Movie): Promise<Scene> => {
    const singleSceneSchema: Schema = {
        type: Type.OBJECT,
        properties: {
            id: { type: Type.STRING },
            duration: { type: Type.NUMBER },
            description: { type: Type.STRING },
            script: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { characterId: { type: Type.STRING }, text: { type: Type.STRING } } } }
        }
    };

    const sceneResponse = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Generate ONE scene. Context: ${currentMovie.title}. Style: ${currentMovie.style}. Prompt: "${prompt}".
        Detect language of the prompt and use it for output.`,
        config: { 
          responseMimeType: "application/json", 
          responseSchema: singleSceneSchema,
          maxOutputTokens: 8192
        }
    });

    const scene = safeJsonParse<Scene>(sceneResponse.text);

    // Generate Image
    const fullPrompt = `${getStyleInstructions(currentMovie.style)} Scene: ${scene.description}. Aspect Ratio ${currentMovie.aspectRatio}.`;
    const bgImage = await generateImage(fullPrompt, currentMovie.aspectRatio);
    if (bgImage) scene.backgroundImageUrl = bgImage;
    
    // Generate Audio if Gemeni mode
    if (currentMovie.audioMode === 'gemini') {
         if (scene.description) {
             scene.narrationAudioData = await generateSpeech(scene.description, 'Fenrir');
         }
         // Note: We are not auto-generating dialogue audio here for single scene edits to save time/tokens, 
         // but could be added if needed.
    }
    
    scene.characters = []; 
    return scene;
}