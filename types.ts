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
  sourceType?: 'youtube' | 'file' | 'text'; // Track how the transcript was imported
  importedAt?: number; // Timestamp of import
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

// Expression comparison result - replaces AccentAnalysisResult
export interface ExpressionComparison {
  userExpression: string;
  originalExpression: string;
  differences: ExpressionDifference[];
  overallScore: number;
}

export interface ExpressionDifference {
  type: 'word_choice' | 'grammar' | 'phrase' | 'missing' | 'extra';
  userPart: string;
  originalPart: string;
  explanation: string;
}

// Vocabulary item for saving unknown words
export interface VocabularyItem {
  id: string;
  word: string;
  translation: string;
  context?: string; // The sentence where the word appeared
  segmentId?: string;
  sessionId?: string;
  createdAt: number;
  reviewCount?: number;
  lastReviewedAt?: number;
}

// Practice session for saving user progress
export interface PracticeSession {
  id: string;
  videoDataId: string;
  segmentId: string;
  userTranslationAttempt: string;
  expressionComparison?: ExpressionComparison;
  recordingUrl?: string; // Base64 or blob URL
  pitchData?: number[];
  createdAt: number;
}

// Saved transcript session for persistence
export interface SavedSession {
  id: string;
  title: string;
  videoData: Omit<VideoData, 'videoUrl'>; // Don't save blob URLs
  practices: PracticeSession[];
  vocabulary: VocabularyItem[];
  motherTongue: string;
  createdAt: number;
  updatedAt: number;
}
