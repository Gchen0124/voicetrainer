
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

export const fetchYouTubeTranscript = async (videoId: string): Promise<TranscriptSegment[]> => {
    try {
        // Call our server-side API to fetch transcripts (avoids CORS issues)
        const response = await fetch(`/api/transcript?videoId=${encodeURIComponent(videoId)}`);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `HTTP ${response.status}: Failed to fetch transcript`);
        }

        const data = await response.json();

        if (!data.segments || data.segments.length === 0) {
            throw new Error('No captions available for this video');
        }

        // Add IDs to segments
        return data.segments.map((item: { text: string; start: number; duration: number }, idx: number) => ({
            id: `seg-${idx}`,
            text: item.text,
            start: item.start,
            duration: item.duration
        }));
    } catch (error) {
        console.error("YouTube Transcript Fetch Error:", error);
        throw new Error(`Failed to fetch transcript: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
