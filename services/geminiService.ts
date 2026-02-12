
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { TranscriptSegment, PronunciationFeedback, ExpressionComparison } from "../types";

const TRANSLATION_MAX_SEGMENTS_PER_BATCH = 20;
const TRANSLATION_MAX_CHARS_PER_BATCH = 2200;
const TRANSLATION_MAX_ATTEMPTS = 3;
const TRANSLATION_TIMEOUT_MS = 90000;
export const TRANSLATION_FALLBACK_TEXT = "[Translation unavailable]";

const getClient = () => {
    const apiKey = process.env.API_KEY;
    if (!apiKey) throw new Error("API Key not found");
    return new GoogleGenAI({ apiKey });
}

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
        promise
            .then((value) => {
                clearTimeout(timeout);
                resolve(value);
            })
            .catch((error) => {
                clearTimeout(timeout);
                reject(error);
            });
    });
};

const sleep = async (ms: number): Promise<void> => {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
};

const normalizeTranslation = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
};

const parseTranslations = (responseText: string, expectedCount: number): Array<string | null> => {
    const parsed = JSON.parse(responseText || "{}") as unknown;

    let rawTranslations: unknown[] = [];
    if (Array.isArray(parsed)) {
        rawTranslations = parsed;
    } else if (parsed && typeof parsed === "object") {
        const obj = parsed as Record<string, unknown>;
        if (Array.isArray(obj.translations)) {
            rawTranslations = obj.translations;
        } else {
            rawTranslations = Array.from({ length: expectedCount }, (_, i) =>
                obj[i.toString()] ?? obj[`[${i}]`] ?? obj[i + 1] ?? obj[`[${i + 1}]`]
            );
        }
    }

    return Array.from({ length: expectedCount }, (_, i) => normalizeTranslation(rawTranslations[i]));
};

type IndexedSegment = {
    index: number;
    segment: TranscriptSegment;
};

export type TranslationProgress = {
    completed: number;
    total: number;
    failed: number;
    translatedSegments: TranscriptSegment[];
};

const buildTranslationBatches = (segments: TranscriptSegment[]): IndexedSegment[][] => {
    const batches: IndexedSegment[][] = [];
    let current: IndexedSegment[] = [];
    let currentChars = 0;

    segments.forEach((segment, index) => {
        const estimatedChars = segment.text.length + 8;
        const exceedsSegmentCap = current.length >= TRANSLATION_MAX_SEGMENTS_PER_BATCH;
        const exceedsCharCap = currentChars + estimatedChars > TRANSLATION_MAX_CHARS_PER_BATCH;

        if (current.length > 0 && (exceedsSegmentCap || exceedsCharCap)) {
            batches.push(current);
            current = [];
            currentChars = 0;
        }

        current.push({ index, segment });
        currentChars += estimatedChars;
    });

    if (current.length > 0) {
        batches.push(current);
    }

    return batches;
};

const requestBatchTranslations = async (
    ai: GoogleGenAI,
    batch: IndexedSegment[],
    targetLanguage: string
): Promise<Array<string | null>> => {
    const inputText = batch.map((entry, i) => `${i + 1}. ${entry.segment.text}`).join("\n");
    const response = await withTimeout(
        ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: `Translate each English line into ${targetLanguage}.
Return JSON only in this exact shape: {"translations":["..."]}.
The number of output items must exactly match the number of input lines, in the same order.
Do not include markdown, comments, or extra keys.

Input:
${inputText}`,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        translations: {
                            type: Type.ARRAY,
                            items: { type: Type.STRING }
                        }
                    },
                    required: ["translations"]
                }
            }
        }),
        TRANSLATION_TIMEOUT_MS,
        `Translation request timed out after ${TRANSLATION_TIMEOUT_MS / 1000}s`
    );

    return parseTranslations(response.text || "{}", batch.length);
};

const translateBatchWithRecovery = async (
    ai: GoogleGenAI,
    batch: IndexedSegment[],
    targetLanguage: string
): Promise<Array<string | null>> => {
    for (let attempt = 1; attempt <= TRANSLATION_MAX_ATTEMPTS; attempt++) {
        try {
            return await requestBatchTranslations(ai, batch, targetLanguage);
        } catch (error) {
            const isFinalAttempt = attempt === TRANSLATION_MAX_ATTEMPTS;
            if (isFinalAttempt) {
                break;
            }

            // brief backoff to reduce provider throttling pressure between retries
            await sleep(1000 * attempt);
        }
    }

    if (batch.length === 1) {
        console.error(`Translation failed for segment ${batch[0].index} after retries.`);
        return [null];
    }

    // Recover partial progress by recursively splitting a failing batch.
    const midpoint = Math.ceil(batch.length / 2);
    const left = batch.slice(0, midpoint);
    const right = batch.slice(midpoint);

    const [leftTranslations, rightTranslations] = await Promise.all([
        translateBatchWithRecovery(ai, left, targetLanguage),
        translateBatchWithRecovery(ai, right, targetLanguage),
    ]);

    return [...leftTranslations, ...rightTranslations];
};

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

export const translateSegments = async (
    segments: TranscriptSegment[],
    targetLanguage: string,
    onProgress?: (progress: TranslationProgress) => void
): Promise<TranscriptSegment[]> => {
    if (segments.length === 0) return [];
    try {
        const ai = getClient();
        const translatedSegments = [...segments];
        const batches = buildTranslationBatches(segments);
        let completed = 0;
        let failed = 0;

        for (const batch of batches) {
            const translations = await translateBatchWithRecovery(ai, batch, targetLanguage);

            batch.forEach((entry, batchIndex) => {
                const translation = translations[batchIndex];
                const resolvedTranslation =
                    translation || entry.segment.translation || TRANSLATION_FALLBACK_TEXT;

                if (resolvedTranslation === TRANSLATION_FALLBACK_TEXT) {
                    failed += 1;
                }

                translatedSegments[entry.index] = {
                    ...entry.segment,
                    translation: resolvedTranslation
                };
            });

            completed += batch.length;
            onProgress?.({
                completed,
                total: segments.length,
                failed,
                translatedSegments: [...translatedSegments]
            });
        }

        return translatedSegments;
    } catch (error) {
        console.error("Translation Error:", error);
        return segments.map((seg) => ({
            ...seg,
            translation: TRANSLATION_FALLBACK_TEXT
        }));
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

// Compare user's expression attempt with the original native expression
export const compareExpressions = async (
    userExpression: string,
    originalExpression: string
): Promise<ExpressionComparison | null> => {
    try {
        const ai = getClient();
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: `Compare the user's English expression with the original native expression.
Identify differences in word choice, grammar, phrasing, missing words, or extra words.
Be encouraging but precise in identifying differences that affect meaning or naturalness.

User's attempt: "${userExpression}"
Original native: "${originalExpression}"

Return a JSON analysis.`,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        userExpression: { type: Type.STRING },
                        originalExpression: { type: Type.STRING },
                        overallScore: { type: Type.NUMBER },
                        differences: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    type: { type: Type.STRING, enum: ["word_choice", "grammar", "phrase", "missing", "extra"] },
                                    userPart: { type: Type.STRING },
                                    originalPart: { type: Type.STRING },
                                    explanation: { type: Type.STRING }
                                },
                                required: ["type", "userPart", "originalPart", "explanation"]
                            }
                        }
                    },
                    required: ["userExpression", "originalExpression", "overallScore", "differences"]
                }
            }
        });
        return JSON.parse(response.text || "{}") as ExpressionComparison;
    } catch (error) {
        console.error("Expression Comparison Error:", error);
        return null;
    }
}

// Translate a single word with context
export const translateWord = async (
    word: string,
    context: string,
    targetLanguage: string
): Promise<string | null> => {
    try {
        const ai = getClient();
        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: `Translate the English word "${word}" to ${targetLanguage}.
Context: "${context}"
Provide only the translation, nothing else. If the word has multiple meanings, choose the one that fits the context.`,
        });
        return response.text?.trim() || null;
    } catch (error) {
        console.error("Word Translation Error:", error);
        return null;
    }
}
