import type { Connect } from 'vite';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);
const readFileAsync = promisify(fs.readFile);
const unlinkAsync = promisify(fs.unlink);

export interface TranscriptItem {
  text: string;
  start: number;
  duration: number;
}

// Parse VTT format to extract segments with timestamps
// YouTube auto-generated VTT has a rolling caption format:
// - Each cue has 2 lines: first is previous text (for karaoke), second has new text with timing tags
// - There are also tiny-duration cues (0.01s) that just repeat text
// We need to extract only the new words from the second line of meaningful cues
function parseVtt(vttContent: string): TranscriptItem[] {
  const segments: TranscriptItem[] = [];
  const lines = vttContent.split('\n');

  let i = 0;
  // Skip header
  while (i < lines.length && !lines[i].includes('-->')) {
    i++;
  }

  while (i < lines.length) {
    const line = lines[i].trim();

    // Look for timestamp line (e.g., "00:00:04.240 --> 00:00:07.269")
    const timestampMatch = line.match(/(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})/);

    if (timestampMatch) {
      const startTime = parseTimestamp(timestampMatch[1]);
      const endTime = parseTimestamp(timestampMatch[2]);
      const duration = endTime - startTime;

      // Skip tiny-duration cues (these are just repeating the previous line)
      if (duration < 0.05) {
        i++;
        // Skip the text lines of this cue
        while (i < lines.length && lines[i].trim() !== '' && !lines[i].includes('-->')) {
          i++;
        }
        continue;
      }

      // Collect text lines until next timestamp or empty line
      i++;
      let textLines: string[] = [];
      while (i < lines.length && lines[i].trim() !== '' && !lines[i].includes('-->')) {
        textLines.push(lines[i]);
        i++;
      }

      // For YouTube auto-captions, the second line contains the new text with timing tags
      // The first line is the "old" text being displayed for karaoke effect
      // We want only the second line (the one with timing tags like <00:00:05.040><c>)
      let textToUse = '';
      if (textLines.length >= 2) {
        // Find the line with timing tags (contains <00:00: pattern)
        const lineWithTags = textLines.find(l => /<\d{2}:\d{2}:\d{2}\.\d{3}>/.test(l));
        if (lineWithTags) {
          textToUse = lineWithTags;
        } else {
          // Fallback: just use the last non-empty line
          textToUse = textLines[textLines.length - 1];
        }
      } else if (textLines.length === 1) {
        textToUse = textLines[0];
      }

      const cleanText = cleanVttText(textToUse);

      if (cleanText.length > 0) {
        segments.push({
          text: cleanText,
          start: startTime,
          duration: duration
        });
      }
    } else {
      i++;
    }
  }

  // Merge consecutive segments that form complete sentences
  return mergeSegments(segments);
}

// Parse timestamp "HH:MM:SS.mmm" to seconds
function parseTimestamp(ts: string): number {
  const parts = ts.split(':');
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const seconds = parseFloat(parts[2]);
  return hours * 3600 + minutes * 60 + seconds;
}

// Clean VTT text by removing timing tags and styling
function cleanVttText(text: string): string {
  return text
    // Remove VTT timing tags like <00:00:05.040>
    .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, '')
    // Remove VTT class tags like <c>
    .replace(/<\/?c[^>]*>/g, '')
    // Remove other HTML-like tags
    .replace(/<[^>]+>/g, '')
    // Decode HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Clean up whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

// Merge segments into more natural sentence-based chunks
function mergeSegments(segments: TranscriptItem[]): TranscriptItem[] {
  if (segments.length === 0) return [];

  const merged: TranscriptItem[] = [];
  let current = { ...segments[0] };

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const combined = current.text + ' ' + seg.text;

    // Merge if: short text, no sentence ending, and reasonable time gap
    const endsWithPunctuation = /[.!?]$/.test(current.text);
    const timeGap = seg.start - (current.start + current.duration);

    if (!endsWithPunctuation && combined.length < 200 && timeGap < 2) {
      current.text = combined;
      current.duration = (seg.start + seg.duration) - current.start;
    } else {
      merged.push(current);
      current = { ...seg };
    }
  }
  merged.push(current);

  return merged;
}

async function getYouTubeTranscript(videoId: string): Promise<TranscriptItem[]> {
  // Create a temp directory for the subtitle file
  const tempDir = os.tmpdir();
  const outputTemplate = path.join(tempDir, `yt_transcript_${videoId}`);
  const expectedFile = `${outputTemplate}.en.vtt`;

  // Clean up any existing files from previous runs
  try {
    const files = fs.readdirSync(tempDir);
    for (const file of files) {
      if (file.startsWith(`yt_transcript_${videoId}`)) {
        try { await unlinkAsync(path.join(tempDir, file)); } catch {}
      }
    }
  } catch {}

  try {
    // Use yt-dlp to download subtitles with retry and network resilience options
    const command = `yt-dlp --write-auto-sub --write-sub --sub-lang en --skip-download --retries 3 --socket-timeout 30 --output "${outputTemplate}.%(ext)s" "https://www.youtube.com/watch?v=${videoId}"`;

    console.log(`Running: ${command}`);

    await execAsync(command, { timeout: 120000 }); // Increased timeout to 2 minutes

    // Check if the file was created
    if (!fs.existsSync(expectedFile)) {
      // Try to find any subtitle file that was created
      const files = fs.readdirSync(tempDir);
      const subFile = files.find(f => f.startsWith(`yt_transcript_${videoId}`) && (f.endsWith('.vtt') || f.endsWith('.srt')));

      if (!subFile) {
        throw new Error('No subtitles available for this video');
      }

      const content = await readFileAsync(path.join(tempDir, subFile), 'utf-8');

      // Cleanup
      try { await unlinkAsync(path.join(tempDir, subFile)); } catch {}

      return parseVtt(content);
    }

    // Read and parse the VTT file
    const vttContent = await readFileAsync(expectedFile, 'utf-8');

    // Cleanup
    try { await unlinkAsync(expectedFile); } catch {}

    return parseVtt(vttContent);
  } catch (error) {
    // Cleanup on error
    try { await unlinkAsync(expectedFile); } catch {}

    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('yt-dlp error:', errorMessage);

    if (errorMessage.includes('not found') || errorMessage.includes('command not found')) {
      throw new Error('yt-dlp is not installed. Please install it with: brew install yt-dlp');
    }

    // Check if it's a network-related error
    if (errorMessage.includes('SSL') || errorMessage.includes('EOF') || errorMessage.includes('timeout')) {
      throw new Error('Network error while fetching transcript. Please try again.');
    }

    throw new Error(`Failed to fetch transcript: ${errorMessage}`);
  }
}

export const transcriptApiMiddleware: Connect.NextHandleFunction = async (req, res, next) => {
  // Only handle our specific API route
  if (!req.url?.startsWith('/api/transcript')) {
    return next();
  }

  // Parse the video ID from the URL
  const url = new URL(req.url, `http://${req.headers.host}`);
  const videoId = url.searchParams.get('videoId');

  if (!videoId) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Missing videoId parameter' }));
    return;
  }

  // Validate video ID format
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Invalid video ID format' }));
    return;
  }

  try {
    console.log(`Fetching transcript for video: ${videoId}`);
    const segments = await getYouTubeTranscript(videoId);

    if (segments.length === 0) {
      throw new Error('No transcript segments found');
    }

    console.log(`Successfully fetched ${segments.length} transcript segments`);

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ segments }));
  } catch (error) {
    console.error('Transcript API Error:', error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      error: error instanceof Error ? error.message : 'Failed to fetch transcript'
    }));
  }
};
