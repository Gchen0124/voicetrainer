import { GoogleGenAI, Type } from "@google/genai";
import { TranscriptSegment } from "../types";

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