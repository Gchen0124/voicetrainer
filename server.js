import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { Innertube } from 'youtubei.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Create a reusable Innertube client (mimics real YouTube web client)
let ytClient = null;
async function getYtClient() {
  if (!ytClient) {
    ytClient = await Innertube.create();
  }
  return ytClient;
}

// ---------- Transcript helpers ----------

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

function cleanText(text) {
  return text
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

async function getYouTubeTranscript(videoId) {
  const yt = await getYtClient();
  const info = await yt.getInfo(videoId);
  const transcriptData = await info.getTranscript();

  const content = transcriptData?.content?.body?.initial_segments;
  if (!content || content.length === 0) {
    throw new Error('No captions available for this video');
  }

  const segments = content
    .filter(seg => seg.type === 'TranscriptSegment')
    .map(seg => ({
      text: cleanText(seg.snippet?.text || ''),
      start: (seg.start_ms || 0) / 1000,
      duration: ((seg.end_ms || 0) - (seg.start_ms || 0)) / 1000,
    }))
    .filter(s => s.text.length > 0 && s.duration > 0.05);

  return mergeSegments(segments);
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
    // Reset client on auth/session errors so next request gets a fresh session
    if (error.message?.includes('captcha') || error.message?.includes('consent') || error.message?.includes('sign in')) {
      ytClient = null;
    }
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
