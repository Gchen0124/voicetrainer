
export interface TranscriptSegment {
  id: string;
  text: string;
  start: number; // seconds
  duration: number; // seconds
  translation?: string; // Mother tongue translation (e.g., Spanish)
  userTranslationAttempt?: string; // What the user thinks the English text is
  isRevealed?: boolean; // Whether the original English is shown
  isCorrect?: boolean; // If user's translation attempt was close enough
}

export interface VideoData {
  id: string;
  title: string;
  videoId?: string; 
  videoUrl?: string; 
  transcript: TranscriptSegment[];
}

export interface AudioRecording {
  id: string;
  blob: Blob;
  url: string;
  timestamp: number;
  segmentId: string;
  pitchData: number[]; 
  duration: number;
}

export interface PronunciationFeedback {
  score: number;
  words: {
    word: string;
    accuracy: 'correct' | 'near' | 'incorrect';
    feedback?: string;
  }[];
  generalTips: string;
}

export type AccentAnalysisResult = {
  feedback: string;
  score: number;
  phonemeIssues: string[];
};
