import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execAsync = promisify(exec);

const app = express();
const PORT = process.env.PORT || 3001;

// ---------- VTT Parsing ----------

function parseTimestamp(ts) {
  const parts = ts.split(':');
  return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
}

function cleanVttText(text) {
  return text
    .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, '')
    .replace(/<\/?c[^>]*>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
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
    const tsMatch = line.match(/(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})/);
    if (tsMatch) {
      const startTime = parseTimestamp(tsMatch[1]);
      const duration = parseTimestamp(tsMatch[2]) - startTime;
      if (duration < 0.05) { i++; while (i < lines.length && lines[i].trim() !== '' && !lines[i].includes('-->')) i++; continue; }
      i++;
      const textLines = [];
      while (i < lines.length && lines[i].trim() !== '' && !lines[i].includes('-->')) { textLines.push(lines[i]); i++; }
      let textToUse = '';
      if (textLines.length >= 2) {
        textToUse = textLines.find(l => /<\d{2}:\d{2}:\d{2}\.\d{3}>/.test(l)) || textLines[textLines.length - 1];
      } else if (textLines.length === 1) { textToUse = textLines[0]; }
      const cleanText = cleanVttText(textToUse);
      if (cleanText.length > 0) segments.push({ text: cleanText, start: startTime, duration });
    } else { i++; }
  }
  return mergeSegments(segments);
}

// ---------- yt-dlp transcript fetching ----------

let ytdlpAvailable = null;

async function checkYtdlp() {
  if (ytdlpAvailable !== null) return ytdlpAvailable;
  try {
    await execAsync('yt-dlp --version', { timeout: 5000 });
    ytdlpAvailable = true;
  } catch {
    ytdlpAvailable = false;
  }
  console.log(`yt-dlp available: ${ytdlpAvailable}`);
  return ytdlpAvailable;
}

async function getYouTubeTranscript(videoId) {
  if (!(await checkYtdlp())) {
    throw new Error(
      'YouTube transcript fetching requires yt-dlp which is not available on this server. ' +
      'Please use "Paste Transcript" or "Upload File" instead.'
    );
  }

  const tempDir = os.tmpdir();
  const outputTemplate = path.join(tempDir, `yt_transcript_${videoId}`);
  const expectedFile = `${outputTemplate}.en.vtt`;

  // Cleanup previous files
  try {
    for (const file of fs.readdirSync(tempDir)) {
      if (file.startsWith(`yt_transcript_${videoId}`)) {
        try { fs.unlinkSync(path.join(tempDir, file)); } catch {}
      }
    }
  } catch {}

  try {
    const command = `yt-dlp --write-auto-sub --write-sub --sub-lang en --skip-download --retries 3 --socket-timeout 30 --output "${outputTemplate}.%(ext)s" "https://www.youtube.com/watch?v=${videoId}"`;
    await execAsync(command, { timeout: 120000 });

    let vttContent;
    if (fs.existsSync(expectedFile)) {
      vttContent = fs.readFileSync(expectedFile, 'utf-8');
      try { fs.unlinkSync(expectedFile); } catch {}
    } else {
      const subFile = fs.readdirSync(tempDir).find(f =>
        f.startsWith(`yt_transcript_${videoId}`) && (f.endsWith('.vtt') || f.endsWith('.srt'))
      );
      if (!subFile) throw new Error('No subtitles available for this video');
      vttContent = fs.readFileSync(path.join(tempDir, subFile), 'utf-8');
      try { fs.unlinkSync(path.join(tempDir, subFile)); } catch {}
    }
    return parseVtt(vttContent);
  } catch (error) {
    try { fs.unlinkSync(expectedFile); } catch {}
    throw error;
  }
}

// ---------- API Routes ----------

app.get('/api/transcript', async (req, res) => {
  const videoId = req.query.videoId;
  if (!videoId) return res.status(400).json({ error: 'Missing videoId parameter' });
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return res.status(400).json({ error: 'Invalid video ID format' });

  try {
    console.log(`Fetching transcript for video: ${videoId}`);
    const segments = await getYouTubeTranscript(videoId);
    if (segments.length === 0) throw new Error('No transcript segments found');
    console.log(`Successfully fetched ${segments.length} transcript segments`);
    res.json({ segments });
  } catch (error) {
    console.error('Transcript API Error:', error.message);
    res.status(500).json({ error: error.message || 'Failed to fetch transcript' });
  }
});

// ---------- Serve Static Build ----------

app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, async () => {
  console.log(`AccentAI Trainer server running on port ${PORT}`);
  await checkYtdlp();
});
