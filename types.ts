export interface TranscriptSegment {
  id: string;
  text: string;
  start: number; // seconds
  duration: number; // seconds
}

export interface VideoData {
  id: string;
  title: string;
  videoId?: string; // YouTube ID (optional now)
  videoUrl?: string; // Local Blob URL for uploaded videos
  transcript: TranscriptSegment[];
}

export interface AudioRecording {
  id: string;
  blob: Blob;
  url: string;
  timestamp: number;
  segmentId: string;
  pitchData: number[]; // Array of frequency values
  duration: number;
}

export interface PitchData {
  frequencies: number[];
  sampleRate: number;
  duration: number;
}

export type AccentAnalysisResult = {
  feedback: string;
  score: number;
  phonemeIssues: string[];
};