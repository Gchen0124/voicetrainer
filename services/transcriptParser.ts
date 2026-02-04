import { TranscriptSegment } from '../types';

// Parse various timestamp formats
// Supports: [00:00], 00:00, 0:00, 00:00:00, [00:00:00], (00:00), etc.
const TIMESTAMP_PATTERNS = [
  /^\[?(\d{1,2}):(\d{2})(?::(\d{2}))?\]?\s*[-–—]?\s*/,  // [0:00] or [00:00:00]
  /^\((\d{1,2}):(\d{2})(?::(\d{2}))?\)\s*[-–—]?\s*/,    // (0:00)
  /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*[-–—]?\s*/,        // 0:00 or 00:00:00
];

interface ParsedLine {
  timestamp: number | null;  // in seconds
  text: string;
}

const parseTimestamp = (line: string): ParsedLine => {
  for (const pattern of TIMESTAMP_PATTERNS) {
    const match = line.match(pattern);
    if (match) {
      const hours = match[3] ? parseInt(match[1], 10) : 0;
      const minutes = match[3] ? parseInt(match[2], 10) : parseInt(match[1], 10);
      const seconds = match[3] ? parseInt(match[3], 10) : parseInt(match[2], 10);
      const totalSeconds = hours * 3600 + minutes * 60 + seconds;
      const text = line.replace(pattern, '').trim();
      return { timestamp: totalSeconds, text };
    }
  }
  return { timestamp: null, text: line.trim() };
};

const splitIntoSentences = (text: string): string[] => {
  // Split by sentence-ending punctuation while preserving the punctuation
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  return sentences.map(s => s.trim()).filter(s => s.length > 0);
};

export const parseTranscriptText = (rawText: string): TranscriptSegment[] => {
  const lines = rawText.split('\n').filter(line => line.trim().length > 0);

  if (lines.length === 0) {
    return [];
  }

  // First pass: detect if we have timestamps
  const parsedLines = lines.map(parseTimestamp);
  const hasTimestamps = parsedLines.some(p => p.timestamp !== null);

  const segments: TranscriptSegment[] = [];

  if (hasTimestamps) {
    // Mode 1: Timestamps provided - use them directly
    let lastTimestamp = 0;

    for (let i = 0; i < parsedLines.length; i++) {
      const { timestamp, text } = parsedLines[i];
      if (!text) continue;

      const currentTimestamp = timestamp ?? lastTimestamp;
      const nextTimestamp = parsedLines[i + 1]?.timestamp ?? currentTimestamp + 5;
      const duration = Math.max(nextTimestamp - currentTimestamp, 1);

      segments.push({
        id: `seg-${i}`,
        text: text,
        start: currentTimestamp,
        duration: duration,
      });

      lastTimestamp = currentTimestamp + duration;
    }
  } else {
    // Mode 2: No timestamps - split into sentences and assign fake timestamps
    const fullText = parsedLines.map(p => p.text).join(' ');
    const sentences = splitIntoSentences(fullText);

    // Estimate ~3 seconds per 10 words as a rough speaking pace
    let currentTime = 0;

    sentences.forEach((sentence, idx) => {
      const wordCount = sentence.split(/\s+/).length;
      const estimatedDuration = Math.max(Math.ceil(wordCount * 0.3), 2); // ~0.3s per word, min 2s

      segments.push({
        id: `seg-${idx}`,
        text: sentence,
        start: currentTime,
        duration: estimatedDuration,
      });

      currentTime += estimatedDuration;
    });
  }

  return segments;
};

// Validate if the input looks like a valid transcript
export const validateTranscriptInput = (text: string): { valid: boolean; error?: string } => {
  const trimmed = text.trim();

  if (!trimmed) {
    return { valid: false, error: 'Please enter some text' };
  }

  if (trimmed.length < 10) {
    return { valid: false, error: 'Text is too short. Please enter at least one sentence.' };
  }

  // Check if it's just numbers/timestamps without content
  const withoutTimestamps = trimmed.replace(/[\[\]()\d:]/g, '').trim();
  if (withoutTimestamps.length < 10) {
    return { valid: false, error: 'Please include actual transcript content, not just timestamps.' };
  }

  return { valid: true };
};

// Auto-detect transcript format and provide helpful message
export const detectTranscriptFormat = (text: string): {
  hasTimestamps: boolean;
  lineCount: number;
  estimatedSegments: number;
  format: string;
} => {
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  const parsedLines = lines.map(parseTimestamp);
  const timestampedLines = parsedLines.filter(p => p.timestamp !== null);

  const hasTimestamps = timestampedLines.length > lines.length * 0.5; // More than 50% have timestamps

  let estimatedSegments: number;
  if (hasTimestamps) {
    estimatedSegments = lines.length;
  } else {
    const fullText = parsedLines.map(p => p.text).join(' ');
    const sentences = splitIntoSentences(fullText);
    estimatedSegments = sentences.length;
  }

  let format: string;
  if (hasTimestamps) {
    format = 'Timestamped transcript detected';
  } else if (lines.length === 1) {
    format = 'Single paragraph - will be split into sentences';
  } else {
    format = 'Plain text - will be split into sentences';
  }

  return {
    hasTimestamps,
    lineCount: lines.length,
    estimatedSegments,
    format,
  };
};
