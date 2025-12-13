import { GoogleGenAI, Modality, Type } from "@google/genai";
import { TranscriptSegment } from "../types";
import { pcmToWavBlob } from "./audioService";

const getClient = () => {
    const apiKey = process.env.API_KEY;
    if (!apiKey) throw new Error("API Key not found");
    return new GoogleGenAI({ apiKey });
}

export const generateTranscript = async (audioBase64: string): Promise<TranscriptSegment[]> => {
    try {
        const ai = getClient();
        
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: {
                parts: [
                    {
                        inlineData: {
                            mimeType: "audio/wav",
                            data: audioBase64
                        }
                    },
                    {
                        text: "Transcribe this audio. Break it down into clear, full-sentence segments suitable for language practice. Ensure the 'text' does not contain speaker labels. Return strictly JSON."
                    }
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

        // Clean up response text if it includes markdown code blocks
        let cleanText = response.text || "{}";
        if (cleanText.startsWith("```json")) {
            cleanText = cleanText.replace(/```json/g, "").replace(/```/g, "");
        } else if (cleanText.startsWith("```")) {
            cleanText = cleanText.replace(/```/g, "");
        }

        const json = JSON.parse(cleanText);
        
        if (json.segments) {
            return json.segments.map((s: any, index: number) => ({
                id: `auto-${index}-${Date.now()}`,
                text: s.text,
                start: s.start,
                duration: s.duration
            }));
        }
        return [];

    } catch (error) {
        console.error("Gemini Transcription Error:", error);
        return [];
    }
}

export const generateSpeechReference = async (text: string): Promise<Blob | null> => {
  try {
    const ai = getClient();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `Say clearly and naturally: ${text}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Fenrir' }, // Deep, clear voice suitable for reference
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) return null;

    // Decode Base64 to Raw Bytes
    const binaryString = atob(base64Audio);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    // Convert Raw PCM to WAV Blob so browsers can decode it
    // Gemini 2.5 TTS output is 24kHz mono
    return pcmToWavBlob(bytes, 24000); 

  } catch (error) {
    console.error("Gemini TTS Error:", error);
    return null;
  }
};

export const analyzeAccent = async (text: string, userTranscript?: string): Promise<string> => {
    try {
        const ai = getClient();
        const prompt = `
        I am an English learner practicing my accent. 
        Target Sentence: "${text}"
        
        Analyze the likely challenges a learner faces with this sentence (connection, stress, intonation).
        Provide 3 bullet points of specific advice on how to sound more like a native speaker when saying this specific sentence.
        Keep it concise and encouraging.
        `;

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
        });

        return response.text || "Could not generate analysis.";
    } catch (error) {
        console.error("Gemini Analysis Error:", error);
        return "Unable to connect to AI service.";
    }
}