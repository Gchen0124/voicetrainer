import express from 'express';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execAsync = promisify(exec);
const readFileAsync = promisify(fs.readFile);
const unlinkAsync = promisify(fs.unlink);

const app = express();
const PORT = process.env.PORT || 3001;

// ---------- VTT Parsing (from server/transcriptApi.ts) ----------

function parseTimestamp(ts) {
  const parts = ts.split(':');
  return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
}

function cleanVttText(text) {
  return text
    .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, '')
    .replace(/<\/?c[^>]*>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mergeSegments(segments) {
  if (segments.length === 0) return [];
  const merged = [];
  let current = { ...segments[0] };
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const combined = current.text + ' ' + seg.text;
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

function parseVtt(vttContent) {
  const segments = [];
  const lines = vttContent.split('\n');
  let i = 0;
  while (i < lines.length && !lines[i].includes('-->')) i++;
  while (i < lines.length) {
    const line = lines[i].trim();
    const timestampMatch = line.match(/(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})/);
    if (timestampMatch) {
      const startTime = parseTimestamp(timestampMatch[1]);
      const endTime = parseTimestamp(timestampMatch[2]);
      const duration = endTime - startTime;
      if (duration < 0.05) {
        i++;
        while (i < lines.length && lines[i].trim() !== '' && !lines[i].includes('-->')) i++;
        continue;
      }
      i++;
      const textLines = [];
      while (i < lines.length && lines[i].trim() !== '' && !lines[i].includes('-->')) {
        textLines.push(lines[i]);
        i++;
      }
      let textToUse = '';
      if (textLines.length >= 2) {
        const lineWithTags = textLines.find(l => /<\d{2}:\d{2}:\d{2}\.\d{3}>/.test(l));
        textToUse = lineWithTags || textLines[textLines.length - 1];
      } else if (textLines.length === 1) {
        textToUse = textLines[0];
      }
      const cleanText = cleanVttText(textToUse);
      if (cleanText.length > 0) {
        segments.push({ text: cleanText, start: startTime, duration });
      }
    } else {
      i++;
    }
  }
  return mergeSegments(segments);
}

async function getYouTubeTranscript(videoId) {
  const tempDir = os.tmpdir();
  const outputTemplate = path.join(tempDir, `yt_transcript_${videoId}`);
  const expectedFile = `${outputTemplate}.en.vtt`;

  try {
    const files = fs.readdirSync(tempDir);
    for (const file of files) {
      if (file.startsWith(`yt_transcript_${videoId}`)) {
        try { await unlinkAsync(path.join(tempDir, file)); } catch {}
      }
    }
  } catch {}

  try {
    const command = `yt-dlp --write-auto-sub --write-sub --sub-lang en --skip-download --retries 3 --socket-timeout 30 --output "${outputTemplate}.%(ext)s" "https://www.youtube.com/watch?v=${videoId}"`;
    console.log(`Running: ${command}`);
    await execAsync(command, { timeout: 120000 });

    let vttContent;
    if (fs.existsSync(expectedFile)) {
      vttContent = await readFileAsync(expectedFile, 'utf-8');
      try { await unlinkAsync(expectedFile); } catch {}
    } else {
      const files = fs.readdirSync(tempDir);
      const subFile = files.find(f => f.startsWith(`yt_transcript_${videoId}`) && (f.endsWith('.vtt') || f.endsWith('.srt')));
      if (!subFile) throw new Error('No subtitles available for this video');
      vttContent = await readFileAsync(path.join(tempDir, subFile), 'utf-8');
      try { await unlinkAsync(path.join(tempDir, subFile)); } catch {}
    }
    return parseVtt(vttContent);
  } catch (error) {
    try { await unlinkAsync(expectedFile); } catch {}
    const msg = error.message || String(error);
    if (msg.includes('not found') || msg.includes('command not found')) {
      throw new Error('yt-dlp is not installed on the server');
    }
    if (msg.includes('SSL') || msg.includes('EOF') || msg.includes('timeout')) {
      throw new Error('Network error while fetching transcript. Please try again.');
    }
    throw new Error(`Failed to fetch transcript: ${msg}`);
  }
}

// ---------- API Routes ----------

app.get('/api/transcript', async (req, res) => {
  const videoId = req.query.videoId;
  if (!videoId) {
    return res.status(400).json({ error: 'Missing videoId parameter' });
  }
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'Invalid video ID format' });
  }
  try {
    console.log(`Fetching transcript for video: ${videoId}`);
    const segments = await getYouTubeTranscript(videoId);
    if (segments.length === 0) throw new Error('No transcript segments found');
    console.log(`Successfully fetched ${segments.length} transcript segments`);
    res.json({ segments });
  } catch (error) {
    console.error('Transcript API Error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch transcript' });
  }
});

// ---------- Serve Static Build ----------

app.use(express.static(path.join(__dirname, 'dist')));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`AccentAI Trainer server running on port ${PORT}`);
});
