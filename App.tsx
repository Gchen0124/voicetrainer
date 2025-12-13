import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, Volume2, Video as VideoIcon, Activity, AlertCircle, Plus, Clock, Youtube, RotateCcw, Upload, FileVideo, Loader2, Play, Trash2, History, MousePointerClick, Pause } from 'lucide-react';
import VideoPlayer from './components/VideoPlayer';
import PitchVisualizer from './components/PitchVisualizer';
import { DEMO_VIDEO } from './constants';
import { TranscriptSegment, VideoData, AudioRecording } from './types';
import { decodeAudioData, detectPitch, getResampledAudioBuffer, sliceAudioBuffer, audioBufferToBase64Wav } from './services/audioService';
import { generateTranscript } from './services/geminiService';

const App: React.FC = () => {
  // State
  const [videoData, setVideoData] = useState<VideoData>(DEMO_VIDEO);
  const [activeSegment, setActiveSegment] = useState<TranscriptSegment | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isInitializingRec, setIsInitializingRec] = useState(false);
  const [recordings, setRecordings] = useState<AudioRecording[]>([]);
  const [currentRecording, setCurrentRecording] = useState<AudioRecording | null>(null);
  const [referencePitch, setReferencePitch] = useState<number[]>([]);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string>('');
  const [fullAudioBuffer, setFullAudioBuffer] = useState<AudioBuffer | null>(null);
  
  // Custom Video State
  const [urlInput, setUrlInput] = useState('');
  
  // Playback Control State
  const [playbackRange, setPlaybackRange] = useState<{start: number, end: number, isPlaying: boolean} | null>(null);

  // Text Selection State
  // We store exact start/end times calculated from the selection
  const [selectionMenu, setSelectionMenu] = useState<{
      x: number, 
      y: number, 
      text: string, 
      startTime: number, 
      endTime: number
  } | null>(null);
  
  const transcriptRef = useRef<HTMLDivElement>(null);

  // Refs
  const playerRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const playbackIntervalRef = useRef<number | null>(null);

  // Initialize Audio Context
  useEffect(() => {
    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    return () => {
      audioContextRef.current?.close();
    };
  }, []);

  // --- Auto-Stop Logic ---
  // This loop monitors playback and stops it when it reaches the end of the selected range
  useEffect(() => {
    if (playbackRange && playbackRange.isPlaying) {
        // Clear existing interval
        if (playbackIntervalRef.current) window.clearInterval(playbackIntervalRef.current);

        playbackIntervalRef.current = window.setInterval(() => {
            if (playerRef.current && typeof playerRef.current.getCurrentTime === 'function') {
                const currentTime = playerRef.current.getCurrentTime();
                
                // Buffer of 0.1s to ensure we don't cut off too early, but stop promptly
                if (currentTime >= playbackRange.end) {
                    playerRef.current.pauseVideo();
                    setPlaybackRange(prev => prev ? { ...prev, isPlaying: false } : null);
                    window.clearInterval(playbackIntervalRef.current!);
                }
            }
        }, 100); // Check every 100ms
    }

    return () => {
        if (playbackIntervalRef.current) window.clearInterval(playbackIntervalRef.current);
    };
  }, [playbackRange]);


  // Helper to extract YouTube ID
  const extractVideoId = (url: string): string | null => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
  };

  const handleLoadYouTube = () => {
    const videoId = extractVideoId(urlInput);
    if (videoId) {
        setVideoData({
            id: Date.now().toString(),
            title: 'YouTube Video',
            videoId: videoId,
            transcript: [] 
        });
        resetSession();
        setFullAudioBuffer(null); 
        setUrlInput(''); 
    } else {
        alert("Invalid YouTube URL");
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Reset UI
    setIsTranscribing(true);
    setProcessingStatus('Preparing audio...');
    resetSession();
    
    // Create Object URL for playback
    const videoUrl = URL.createObjectURL(file);
    
    try {
        setVideoData({
            id: Date.now().toString(),
            title: file.name,
            videoUrl: videoUrl,
            transcript: []
        });

        // 1. Get Resampled Audio (16kHz Mono)
        const resampledBuffer = await getResampledAudioBuffer(file);
        
        if (!resampledBuffer) {
             throw new Error("Failed to process audio");
        }
        
        setFullAudioBuffer(resampledBuffer);

        // 2. Chunking Logic for Gemini
        const CHUNK_DURATION = 300; 
        const totalDuration = resampledBuffer.duration;
        let allSegments: TranscriptSegment[] = [];

        for (let startTime = 0; startTime < totalDuration; startTime += CHUNK_DURATION) {
            const currentPart = Math.floor(startTime / CHUNK_DURATION) + 1;
            const totalParts = Math.ceil(totalDuration / CHUNK_DURATION);
            setProcessingStatus(`Transcribing part ${currentPart} of ${totalParts}...`);

            const chunkBuffer = sliceAudioBuffer(resampledBuffer, startTime, CHUNK_DURATION);
            if (!chunkBuffer) continue;

            const base64Wav = await audioBufferToBase64Wav(chunkBuffer);
            const segments = await generateTranscript(base64Wav);
            
            const adjustedSegments = segments.map((s, idx) => ({
                ...s,
                start: s.start + startTime,
                id: `seg-${startTime}-${idx}`
            }));

            allSegments = [...allSegments, ...adjustedSegments];
        }

        setVideoData(prev => ({
            ...prev,
            transcript: allSegments.sort((a,b) => a.start - b.start)
        }));

    } catch (e) {
        console.error("Upload error", e);
        alert("Error processing video file.");
    } finally {
        setIsTranscribing(false);
        setProcessingStatus('');
        if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const resetSession = () => {
      setActiveSegment(null);
      setRecordings([]);
      setCurrentRecording(null);
      setReferencePitch([]);
      setSelectionMenu(null);
      setPlaybackRange(null);
  }

  const handleResetDemo = () => {
      setVideoData(DEMO_VIDEO);
      resetSession();
      setFullAudioBuffer(null);
  }

  const playRange = (start: number, end: number) => {
      if (playerRef.current) {
          playerRef.current.seekTo(start, true);
          playerRef.current.playVideo();
          setPlaybackRange({ start, end, isPlaying: true });
      }
  }

  const pauseRange = () => {
      if (playerRef.current) {
          playerRef.current.pauseVideo();
          setPlaybackRange(prev => prev ? { ...prev, isPlaying: false } : null);
      }
  }

  // Sets up the practice studio with the selected range
  const handlePracticeSelection = () => {
      if (!selectionMenu) return;

      const duration = selectionMenu.endTime - selectionMenu.startTime;
      
      const customSegment: TranscriptSegment = {
          id: `custom-${Date.now()}`,
          text: selectionMenu.text,
          start: selectionMenu.startTime,
          duration: Math.max(0.5, duration) // Ensure minimum duration
      };

      // Set as active practice segment
      handleSegmentClick(customSegment, true); // true = don't play immediately, just set active
      
      // Clear menu
      setSelectionMenu(null);
      window.getSelection()?.removeAllRanges();
  };

  const handleSegmentClick = async (segment: TranscriptSegment, silentSet: boolean = false) => {
    // Set as active (Highlights it)
    setActiveSegment(segment);
    
    // Load history
    const segmentRecordings = recordings.filter(r => r.segmentId === segment.id);
    const lastRec = segmentRecordings.length > 0 ? segmentRecordings[segmentRecordings.length - 1] : null;
    setCurrentRecording(lastRec);

    setReferencePitch([]); 

    // Extract Pitch
    if (fullAudioBuffer) {
        const segmentBuffer = sliceAudioBuffer(fullAudioBuffer, segment.start, segment.duration);
        if (segmentBuffer) {
            const pitch = detectPitch(segmentBuffer);
            setReferencePitch(pitch);
        }
    }

    // Play if not silent mode
    if (!silentSet) {
        playRange(segment.start, segment.start + segment.duration);
    }
  };

  // --- Robust Text Selection Logic ---
  const handleTextMouseUp = () => {
      const selection = window.getSelection();
      // Ensure we have a valid text selection (not just a click)
      if (!selection || selection.toString().trim().length === 0) {
          // If the user clicked somewhere else (collapsed selection), we might want to close the menu
          // But we have a global click handler for that. Here we just return.
          return;
      }

      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const containerRect = transcriptRef.current?.getBoundingClientRect();
      
      if (!containerRect) return;

      // Helper to find the closest transcript segment index from a DOM node
      // This is crucial: selection.anchorNode might be the TextNode, so we need to check parent
      const getSegmentIndex = (node: Node | null): number => {
          if (!node) return -1;
          const element = node.nodeType === 3 ? node.parentElement : node as HTMLElement;
          const closestSpan = element?.closest('span[data-index]');
          
          if (closestSpan) {
              return parseInt(closestSpan.getAttribute('data-index') || '-1');
          }
          return -1;
      };

      const startIndex = getSegmentIndex(range.startContainer);
      const endIndex = getSegmentIndex(range.endContainer);

      // Validate indices
      if (startIndex === -1 || endIndex === -1 || !videoData.transcript[startIndex] || !videoData.transcript[endIndex]) {
          console.log('Selection outside valid transcript segments');
          return;
      }

      const startSeg = videoData.transcript[startIndex];
      const endSeg = videoData.transcript[endIndex];
      
      // Interpolate Start Time
      const startOffset = range.startOffset;
      const startPercent = startOffset / (startSeg.text.length || 1);
      const startTime = startSeg.start + (startSeg.duration * startPercent);
      
      // Interpolate End Time
      const endOffset = range.endOffset;
      const endPercent = endOffset / (endSeg.text.length || 1);
      const endTime = endSeg.start + (endSeg.duration * endPercent);

      // Position the menu
      // We check if the rect is valid (sometimes zero if invisible)
      if (rect.width > 0 && rect.height > 0) {
        setSelectionMenu({
            x: rect.left + (rect.width / 2) - containerRect.left,
            y: rect.top - containerRect.top,
            text: selection.toString().trim(),
            startTime: startTime,
            endTime: endTime
        });
      }
  };

  // Close menu if clicking elsewhere
  useEffect(() => {
      const closeMenu = () => setSelectionMenu(null);
      // We attach to window but we need to stop propagation on the menu itself
      window.addEventListener('click', closeMenu);
      return () => window.removeEventListener('click', closeMenu);
  }, []);

  const startRecording = async () => {
    if (!activeSegment) {
        alert("Please select a transcript line to practice first.");
        return;
    }
    
    if (audioContextRef.current?.state === 'suspended') {
        try {
            await audioContextRef.current.resume();
        } catch (e) {
            console.error("Could not resume audio context", e);
        }
    }

    setCurrentRecording(null);
    setIsInitializingRec(true);

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error("Media devices not supported or blocked");
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const mimeType = mediaRecorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        const audioUrl = URL.createObjectURL(audioBlob);
        
        let pitchData: number[] = [];
        if (audioContextRef.current) {
             try {
                 const buffer = await decodeAudioData(audioContextRef.current, audioBlob);
                 pitchData = detectPitch(buffer);
             } catch (e) {
                 console.error("Error analyzing user pitch:", e);
             }
        }

        const newRecording: AudioRecording = {
          id: Date.now().toString(),
          blob: audioBlob,
          url: audioUrl,
          timestamp: Date.now(),
          segmentId: activeSegment.id,
          pitchData,
          duration: 0 
        };

        setRecordings(prev => [...prev, newRecording]);
        setCurrentRecording(newRecording);
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err: any) {
      console.error("Error accessing microphone:", err);
      alert("Microphone Access Blocked.");
    } finally {
        setIsInitializingRec(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      if (mediaRecorderRef.current.state !== "inactive") {
          mediaRecorderRef.current.stop();
      }
      setIsRecording(false);
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const playRecording = (rec: AudioRecording) => {
    setCurrentRecording(rec); 
    const audio = new Audio(rec.url);
    audio.play();
  };

  const deleteRecording = (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setRecordings(prev => prev.filter(r => r.id !== id));
      if (currentRecording?.id === id) {
          setCurrentRecording(null);
      }
  };

  const segmentHistory = recordings.filter(r => r.segmentId === activeSegment?.id).reverse();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-6 h-6 text-indigo-600" />
            <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent hidden sm:block">AccentAI Trainer</h1>
          </div>
          
          <div className="flex-1 max-w-2xl mx-4 flex gap-3">
              <div className="flex gap-2 flex-1">
                  <div className="relative flex-1">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                          <Youtube className="h-4 w-4 text-slate-400" />
                      </div>
                      <input
                          type="text"
                          value={urlInput}
                          onChange={(e) => setUrlInput(e.target.value)}
                          placeholder="Paste YouTube Link..."
                          className="block w-full pl-10 pr-3 py-2 border border-slate-300 rounded-md leading-5 bg-slate-50 placeholder-slate-400 focus:outline-none focus:bg-white focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm transition duration-150 ease-in-out"
                      />
                  </div>
                  <button 
                    onClick={handleLoadYouTube}
                    className="px-3 py-2 border border-transparent text-sm font-medium rounded-md text-slate-700 bg-slate-100 hover:bg-slate-200 focus:outline-none whitespace-nowrap"
                  >
                    Load
                  </button>
              </div>

              <div className="h-9 w-px bg-slate-300 self-center"></div>

              <input 
                  type="file" 
                  ref={fileInputRef}
                  accept="video/*" 
                  onChange={handleFileUpload} 
                  className="hidden" 
              />
              <button 
                onClick={() => fileInputRef.current?.click()}
                disabled={isTranscribing}
                className="flex items-center gap-2 px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 whitespace-nowrap shadow-sm"
              >
                  {isTranscribing ? <Loader2 className="w-4 h-4 animate-spin"/> : <Upload className="w-4 h-4" />}
                  {isTranscribing ? 'Processing...' : 'Upload Video'}
              </button>
              
              {videoData.id !== DEMO_VIDEO.id && (
                    <button 
                    onClick={handleResetDemo}
                    className="p-2 text-slate-400 hover:text-indigo-600 transition-colors"
                    title="Reset to Demo"
                    >
                        <RotateCcw className="w-5 h-5" />
                    </button>
                )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-4 sm:p-6 lg:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: Video & Transcript */}
        <div className="lg:col-span-7 flex flex-col gap-6">
            {/* Video Section */}
            <div className="w-full">
                <VideoPlayer 
                    videoId={videoData.videoId} 
                    videoUrl={videoData.videoUrl}
                    onReady={(player) => playerRef.current = player}
                />
            </div>

            {/* Transcript Reader Section */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col flex-1 min-h-[400px]">
                <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                    <div>
                        <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                            <VideoIcon className="w-4 h-4 text-slate-500" />
                            Transcript
                        </h2>
                        <p className="text-xs text-slate-500 mt-1">
                            Highlight any text to play or practice.
                            {isTranscribing && <span className="text-indigo-600 ml-2 animate-pulse">{processingStatus}</span>}
                        </p>
                    </div>
                </div>

                {/* Continuous Text Reader View */}
                <div 
                    ref={transcriptRef}
                    onMouseUp={handleTextMouseUp}
                    className="relative overflow-y-auto custom-scrollbar p-6 flex-1 max-h-[500px] leading-relaxed text-lg text-slate-700 select-text"
                >
                    {/* Floating Selection Menu */}
                    {selectionMenu && (
                        <div 
                            onClick={(e) => e.stopPropagation()} // Prevent closing when clicking the menu itself
                            style={{ 
                                position: 'absolute', 
                                top: selectionMenu.y - 50, 
                                left: selectionMenu.x, 
                                transform: 'translateX(-50%)' 
                            }}
                            className="z-50 animate-in zoom-in-95 duration-200 flex gap-2"
                        >
                            <div className="bg-slate-900 text-white p-1 rounded-full shadow-xl flex items-center gap-1">
                                <button
                                    onClick={() => playRange(selectionMenu.startTime, selectionMenu.endTime)}
                                    className="p-2 hover:bg-slate-700 rounded-full transition-colors group"
                                    title="Play Selection"
                                >
                                    <Play className="w-4 h-4 fill-white group-hover:scale-110 transition-transform" />
                                </button>
                                <button
                                    onClick={pauseRange}
                                    className="p-2 hover:bg-slate-700 rounded-full transition-colors group"
                                    title="Pause"
                                >
                                    <Pause className="w-4 h-4 fill-white group-hover:scale-110 transition-transform" />
                                </button>
                                <div className="w-px h-4 bg-slate-700 mx-1"></div>
                                <button
                                    onClick={handlePracticeSelection}
                                    className="px-3 py-1 hover:bg-slate-700 rounded-full text-xs font-medium flex items-center gap-2 transition-colors"
                                >
                                    <Mic className="w-3 h-3" /> Practice
                                </button>
                            </div>
                            {/* Arrow Pointer */}
                            <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-slate-900"></div>
                        </div>
                    )}

                    {videoData.transcript.length === 0 && !isTranscribing ? (
                         <div className="flex flex-col items-center justify-center h-48 text-slate-400">
                             <FileVideo className="w-8 h-8 mb-2 opacity-50" />
                             <p className="text-sm">No transcript available.</p>
                             <p className="text-xs mt-1">Upload a video to start!</p>
                        </div>
                    ) : (
                        <div className="whitespace-pre-wrap relative">
                             {/* Render text with data-index for timestamp interpolation */}
                             {videoData.transcript.map((seg, idx) => (
                                <span 
                                    key={seg.id}
                                    data-index={idx}
                                    className={`transition-colors duration-200 rounded px-0.5 py-0.5 ${
                                        activeSegment?.id === seg.id 
                                        ? 'bg-indigo-50 text-indigo-900 font-medium' 
                                        : 'hover:bg-slate-100'
                                    }`}
                                >
                                    {seg.text}{' '}
                                </span>
                             ))}
                        </div>
                    )}
                    
                    {isTranscribing && (
                        <div className="mt-4 flex items-center gap-2 text-indigo-600 text-sm animate-pulse">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            {processingStatus}
                        </div>
                    )}
                </div>
            </div>
        </div>

        {/* Right Column: Practice Area */}
        <div className="lg:col-span-5 flex flex-col gap-6">
            
            {/* Recording Controls */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 relative">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                        <Mic className="w-4 h-4 text-indigo-500" />
                        Practice Studio
                    </h2>
                    {activeSegment && (
                        <button 
                            onClick={() => playRange(activeSegment.start, activeSegment.start + activeSegment.duration)}
                            className="flex items-center gap-1 text-xs bg-indigo-50 text-indigo-600 hover:bg-indigo-100 px-2 py-1 rounded border border-indigo-200 transition-colors"
                        >
                            <Play className="w-3 h-3" /> Replay Native
                        </button>
                    )}
                </div>

                {activeSegment ? (
                    <div className="space-y-6">
                        <div className="text-center p-4 bg-slate-50 rounded-lg border border-slate-200 border-dashed">
                            <p className="text-lg text-slate-700 italic">"{activeSegment.text}"</p>
                        </div>

                        <div className="flex justify-center gap-4">
                            {!isRecording ? (
                                <button 
                                    onClick={startRecording}
                                    disabled={isInitializingRec}
                                    className={`flex flex-col items-center gap-2 group ${isInitializingRec ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    <div className={`w-16 h-16 rounded-full bg-red-500 text-white flex items-center justify-center shadow-lg shadow-red-200 transition-transform ${isInitializingRec ? '' : 'group-hover:scale-105 group-active:scale-95'}`}>
                                        {isInitializingRec ? <Loader2 className="w-8 h-8 animate-spin" /> : <Mic className="w-8 h-8" />}
                                    </div>
                                    <span className="text-sm font-medium text-slate-600">{isInitializingRec ? 'Starting...' : 'Record'}</span>
                                </button>
                            ) : (
                                <button 
                                    onClick={stopRecording}
                                    className="flex flex-col items-center gap-2 group"
                                >
                                    <div className="w-16 h-16 rounded-full bg-slate-800 text-white flex items-center justify-center shadow-lg animate-pulse">
                                        <Square className="w-6 h-6 fill-current" />
                                    </div>
                                    <span className="text-sm font-medium text-red-500">Stop</span>
                                </button>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="h-40 flex items-center justify-center text-slate-400 text-sm">
                        <div className="text-center">
                            <AlertCircle className="w-6 h-6 mx-auto mb-2 opacity-50" />
                            Select text in the transcript and click 'Practice' to start.
                        </div>
                    </div>
                )}
            </div>

            {/* Pitch Visualizer */}
            {activeSegment && (
                <>
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 relative min-h-[250px] flex flex-col">
                     <div className="flex justify-between items-center mb-4">
                        <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                            <Activity className="w-4 h-4 text-emerald-500" />
                            Tone & Pitch Visualizer
                        </h2>
                    </div>
                    
                    <div className="flex-1 w-full bg-slate-50 rounded-lg relative">
                         {(currentRecording || referencePitch.length > 0) ? (
                            <PitchVisualizer 
                                userPitch={currentRecording?.pitchData || []} 
                                referencePitch={referencePitch}
                                width={600}
                                height={200}
                            />
                         ) : (
                            <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm p-8 text-center">
                                {!fullAudioBuffer 
                                    ? "Record your voice to visualize your pitch.\n(Native pitch curve available for uploaded videos only)" 
                                    : "Record your voice to see the pitch comparison."}
                            </div>
                         )}
                    </div>
                    
                    {currentRecording && (
                        <div className="mt-4 flex justify-center">
                             <button 
                                onClick={() => playRecording(currentRecording)}
                                className="flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-800 font-medium px-4 py-2 hover:bg-indigo-50 rounded-lg transition-colors"
                            >
                                <Volume2 className="w-4 h-4" /> Play Current Take
                            </button>
                        </div>
                    )}
                </div>

                {/* Session History */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex flex-col max-h-[300px]">
                    <div className="flex justify-between items-center mb-2">
                         <h2 className="font-semibold text-slate-800 flex items-center gap-2 text-sm">
                            <History className="w-4 h-4 text-slate-500" />
                            Session History <span className="text-slate-400 font-normal">({segmentHistory.length})</span>
                        </h2>
                    </div>
                    
                    <div className="overflow-y-auto custom-scrollbar flex-1 space-y-2 pr-1">
                        {segmentHistory.length === 0 ? (
                            <div className="text-center py-6 text-slate-400 text-xs italic">
                                No recordings for this sentence yet.
                            </div>
                        ) : (
                            segmentHistory.map((rec, idx) => (
                                <div 
                                    key={rec.id} 
                                    className={`flex items-center justify-between p-2 rounded-lg border transition-all ${
                                        currentRecording?.id === rec.id 
                                        ? 'bg-indigo-50 border-indigo-200' 
                                        : 'bg-white border-slate-100 hover:border-slate-300'
                                    }`}
                                >
                                    <div 
                                        onClick={() => playRecording(rec)}
                                        className="flex items-center gap-3 cursor-pointer flex-1"
                                    >
                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${currentRecording?.id === rec.id ? 'bg-indigo-200 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>
                                            <Play className="w-3 h-3 fill-current" />
                                        </div>
                                        <div>
                                            <p className={`text-sm font-medium ${currentRecording?.id === rec.id ? 'text-indigo-900' : 'text-slate-700'}`}>
                                                Take {segmentHistory.length - idx}
                                            </p>
                                            <p className="text-xs text-slate-400">
                                                {new Date(rec.timestamp).toLocaleTimeString()}
                                            </p>
                                        </div>
                                    </div>
                                    <button 
                                        onClick={(e) => deleteRecording(rec.id, e)}
                                        className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
                                        title="Delete recording"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </div>
                </>
            )}
        </div>
      </main>
    </div>
  );
};

export default App;