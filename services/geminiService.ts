
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { TranscriptSegment, PronunciationFeedback } from "../types";

const getClient = () => {
    const apiKey = process.env.API_KEY;
    if (!apiKey) throw new Error("API Key not found");
    return new GoogleGenAI({ apiKey });
}

export const generateTranscript = async (audioBase64: string): Promise<TranscriptSegment[]> => {
    try {
        const ai = getClient();
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: {
                parts: [
                    { inlineData: { mimeType: "audio/wav", data: audioBase64 } },
                    { text: "Transcribe this audio into detailed, verbatim segments for language learning. Each segment should be a single complete sentence. Return JSON." }
                ]
            },
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        segments: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    text: { type: Type.STRING },
                                    start: { type: Type.NUMBER },
                                    duration: { type: Type.NUMBER }
                                },
                                required: ["text", "start", "duration"]
                            }
                        }
                    }
                }
            }
        });
        const json = JSON.parse(response.text || "{}");
        return json.segments || [];
    } catch (error) {
        console.error("Transcription Error:", error);
        return [];
    }
}

export const fetchYouTubeTranscript = async (videoId: string, title: string): Promise<TranscriptSegment[]> => {
    try {
        const ai = getClient();
        // Updated prompt to be much more greedy and verbatim
        const response = await ai.models.generateContent({
            model: "gemini-3-pro-preview",
            contents: `Find or reconstruct the FULL VERBATIM transcript for the YouTube video "${title}" (ID: ${videoId}). 
            I need a comprehensive breakdown into 30-40 granular segments (individual sentences or very short paragraphs) that cover the entire duration of the video.
            Ensure timestamps are precise to the second. 
            Do NOT summarize. Do NOT provide highlights. I need the actual spoken words verbatimly.
            Return exactly as a JSON array named 'segments'.`,
            config: {
                tools: [{ googleSearch: {} }],
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        segments: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    text: { type: Type.STRING },
                                    start: { type: Type.NUMBER },
                                    duration: { type: Type.NUMBER }
                                },
                                required: ["text", "start", "duration"]
                            }
                        }
                    }
                }
            }
        });
        const json = JSON.parse(response.text || "{}");
        return json.segments || [];
    } catch (error) {
        console.error("YouTube Fetch Error:", error);
        return [];
    }
}

export const translateSegments = async (segments: TranscriptSegment[], targetLanguage: string): Promise<TranscriptSegment[]> => {
    if (segments.length === 0) return [];
    try {
        const ai = getClient();
        // Improved batch translation for larger segment counts
        const textToTranslate = segments.map((s, i) => `[${i}]: ${s.text}`).join("\n");
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: `Translate the following English transcript segments into ${targetLanguage}. 
            Keep the bracketed indices [i] so I can map them back.
            Return a JSON object where the keys are the indices (e.g., "0", "1") and values are the translations.\n\n${textToTranslate}`,
            config: {
                responseMimeType: "application/json",
            }
        });
        const translations = JSON.parse(response.text || "{}");
        return segments.map((seg, i) => ({ 
            ...seg, 
            translation: translations[i.toString()] || translations[i] || "Translation missing" 
        }));
    } catch (error) {
        console.error("Translation Error:", error);
        return segments;
    }
}

export const generateNativeSpeech = async (text: string): Promise<string | null> => {
    try {
        const ai = getClient();
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text: `Say clearly and naturally: ${text}` }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
                },
            },
        });
        return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
    } catch (error) {
        console.error("TTS Error:", error);
        return null;
    }
}

export const evaluatePronunciation = async (audioBase64: string, targetText: string): Promise<PronunciationFeedback | null> => {
    try {
        const ai = getClient();
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: {
                parts: [
                    { inlineData: { mimeType: "audio/wav", data: audioBase64 } },
                    { text: `Evaluate the speaker's pronunciation against this target: "${targetText}". Return JSON.` }
                ]
            },
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        score: { type: Type.NUMBER },
                        words: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    word: { type: Type.STRING },
                                    accuracy: { type: Type.STRING, enum: ["correct", "near", "incorrect"] },
                                    feedback: { type: Type.STRING }
                                },
                                required: ["word", "accuracy"]
                            }
                        },
                        generalTips: { type: Type.STRING }
                    }
                }
            }
        });
        return JSON.parse(response.text || "{}") as PronunciationFeedback;
    } catch (error) {
        console.error("Evaluation Error:", error);
        return null;
    }
}
