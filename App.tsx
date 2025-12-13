import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, Volume2, Video as VideoIcon, Activity, AlertCircle, Plus, Clock, Youtube, RotateCcw, Upload, FileVideo, Loader2, Play, Trash2, History, MousePointerClick, Check } from 'lucide-react';
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
  const [isAddingSegment, setIsAddingSegment] = useState(false);
  const [newSegText, setNewSegText] = useState('');
  const [newSegStart, setNewSegStart] = useState<string>('');
  const [newSegDuration, setNewSegDuration] = useState<string>('5');

  // Text Selection State
  const [selectionMenu, setSelectionMenu] = useState<{x: number, y: number, text: string} | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  // Refs
  const playerRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize Audio Context
  useEffect(() => {
    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    return () => {
      audioContextRef.current?.close();
    };
  }, []);

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
            transcript: [] // Start with empty transcript for custom videos
        });
        resetSession();
        setFullAudioBuffer(null); // No raw audio access for YouTube
        setUrlInput(''); // Clear input
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

        // 1. Get Resampled Audio (16kHz Mono) - Used for both Gemini and Pitch Detection
        // This processes the whole file once
        const resampledBuffer = await getResampledAudioBuffer(file);
        
        if (!resampledBuffer) {
             throw new Error("Failed to process audio");
        }
        
        setFullAudioBuffer(resampledBuffer);

        // 2. Chunking Logic for Gemini
        const CHUNK_DURATION = 300; // 5 minutes in seconds
        const totalDuration = resampledBuffer.duration;
        let allSegments: TranscriptSegment[] = [];

        for (let startTime = 0; startTime < totalDuration; startTime += CHUNK_DURATION) {
            const currentPart = Math.floor(startTime / CHUNK_DURATION) + 1;
            const totalParts = Math.ceil(totalDuration / CHUNK_DURATION);
            setProcessingStatus(`Transcribing part ${currentPart} of ${totalParts}...`);

            // Slice the buffer
            const chunkBuffer = sliceAudioBuffer(resampledBuffer, startTime, CHUNK_DURATION);
            if (!chunkBuffer) continue;

            // Convert chunk to Base64 WAV
            const base64Wav = await audioBufferToBase64Wav(chunkBuffer);
            
            // Send to Gemini
            const segments = await generateTranscript(base64Wav);
            
            // Adjust timestamps relative to the whole video
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
        // Clear input so same file can be selected again if needed
        if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const resetSession = () => {
      setActiveSegment(null);
      setRecordings([]);
      setCurrentRecording(null);
      setReferencePitch([]);
      setIsAddingSegment(false);
      setSelectionMenu(null);
  }

  const handleResetDemo = () => {
      setVideoData(DEMO_VIDEO);
      resetSession();
      setFullAudioBuffer(null); // Demo video is YouTube-based, so no buffer
  }

  const handleCaptureTime = () => {
      if(playerRef.current) {
          const time = playerRef.current.getCurrentTime();
          setNewSegStart(time.toFixed(2));
      }
  };

  const handleAddSegment = () => {
      if (!newSegText || !newSegStart) return;
      
      const start = parseFloat(newSegStart);
      const duration = parseFloat(newSegDuration) || 5;

      const newSegment: TranscriptSegment = {
          id: Date.now().toString(),
          text: newSegText,
          start: start,
          duration: duration
      };

      // We don't necessarily need to add it to the main transcript list if it's a temp practice segment,
      // but let's add it for persistence in this session.
      setVideoData(prev => ({
          ...prev,
          transcript: [...prev.transcript, newSegment].sort((a,b) => a.start - b.start)
      }));

      // Immediately select and play it
      handleSegmentClick(newSegment);
      
      // Reset form
      setNewSegText('');
      setNewSegStart('');
      setIsAddingSegment(false);
  };

  const playSegmentVideo = (start: number) => {
      if (playerRef.current) {
          playerRef.current.seekTo(start, true);
          if (playerRef.current.playVideo) {
             playerRef.current.playVideo();
          }
      }
  }

  const handleSegmentClick = async (segment: TranscriptSegment) => {
    // If clicking the ALREADY active segment, TRIGGER PLAY
    if (activeSegment?.id === segment.id) {
        playSegmentVideo(segment.start);
        return;
    }

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
  };

  // Text Selection Handler
  const handleTextMouseUp = () => {
      const selection = window.getSelection();
      if (!selection || selection.toString().trim().length === 0) {
          setSelectionMenu(null);
          return;
      }

      const text = selection.toString().trim();
      
      // Calculate position for popover
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const containerRect = transcriptRef.current?.getBoundingClientRect();
      
      if (containerRect) {
          setSelectionMenu({
              x: rect.left + (rect.width / 2) - containerRect.left,
              y: rect.top - containerRect.top,
              text: text
          });
      }
  };

  const handlePracticeSelection = () => {
      if (!selectionMenu) return;
      
      setNewSegText(selectionMenu.text);
      setIsAddingSegment(true);
      setSelectionMenu(null);
      
      // Clear native selection
      window.getSelection()?.removeAllRanges();

      // Try to find if this text matches an existing segment to guess time
      const match = videoData.transcript.find(t => t.text.includes(selectionMenu.text) || selectionMenu.text.includes(t.text));
      if (match) {
          setNewSegStart(match.start.toString());
          setNewSegDuration(match.duration.toString());
      } else {
          // If no match, try to use current video time as a guess, but focus the input
          if(playerRef.current) {
               setNewSegStart(playerRef.current.getCurrentTime().toFixed(2));
          }
      }
  };

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

  // Combine segments into full text for "Reader Mode"
  const fullTranscriptText = videoData.transcript.map(t => t.text).join(' ');

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
                            Highlight text to practice a specific part.
                            {isTranscribing && <span className="text-indigo-600 ml-2 animate-pulse">{processingStatus}</span>}
                        </p>
                    </div>
                </div>

                {/* Manual Segment Editor - Anchored at Top if Active */}
                {isAddingSegment && (
                    <div className="p-4 bg-indigo-50 border-b border-indigo-100 animate-in slide-in-from-top-2 duration-200 shadow-inner">
                        <div className="space-y-3">
                            <div className="flex justify-between items-center">
                                <h3 className="text-sm font-bold text-indigo-900 flex items-center gap-2">
                                    <MousePointerClick className="w-4 h-4" /> Anchor & Confirm Selection
                                </h3>
                                <button 
                                    onClick={() => setIsAddingSegment(false)} 
                                    className="text-indigo-400 hover:text-indigo-700 text-xs underline"
                                >
                                    Cancel
                                </button>
                            </div>
                            
                            <div>
                                <label className="block text-xs font-medium text-indigo-900 mb-1">Selected Text</label>
                                <textarea
                                    value={newSegText}
                                    onChange={(e) => setNewSegText(e.target.value)}
                                    className="w-full text-sm rounded-md border-indigo-200 focus:border-indigo-500 focus:ring-indigo-500 min-h-[60px]"
                                />
                            </div>
                            <div className="flex gap-4 items-end">
                                <div className="flex-1">
                                    <label className="block text-xs font-medium text-indigo-900 mb-1">Start Time (sec)</label>
                                    <div className="flex gap-2">
                                        <input 
                                            type="number" 
                                            step="0.1"
                                            value={newSegStart}
                                            onChange={(e) => setNewSegStart(e.target.value)}
                                            placeholder="Use Capture ->"
                                            className="w-full text-sm rounded-md border-indigo-200 focus:border-indigo-500 focus:ring-indigo-500 bg-white"
                                        />
                                        <button 
                                            onClick={handleCaptureTime}
                                            className="flex items-center gap-2 px-3 py-2 bg-indigo-100 border border-indigo-200 rounded text-xs font-medium text-indigo-700 hover:bg-indigo-200 whitespace-nowrap transition-colors"
                                            title="Use current video time as start"
                                        >
                                            <Clock className="w-4 h-4" /> Capture Time
                                        </button>
                                    </div>
                                </div>
                                <div className="w-24">
                                    <label className="block text-xs font-medium text-indigo-900 mb-1">Duration (s)</label>
                                    <input 
                                        type="number" 
                                        value={newSegDuration}
                                        onChange={(e) => setNewSegDuration(e.target.value)}
                                        className="w-full text-sm rounded-md border-indigo-200 focus:border-indigo-500 focus:ring-indigo-500"
                                    />
                                </div>
                                <button 
                                    onClick={handleAddSegment}
                                    className="px-6 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 shadow-sm flex items-center gap-2"
                                >
                                    Confirm & Play <Play className="w-3 h-3 fill-white" />
                                </button>
                            </div>
                            <p className="text-xs text-indigo-600/70 italic mt-1">
                                * Find the start of the sentence in the video player, then click "Capture Time".
                            </p>
                        </div>
                    </div>
                )}

                {/* Continuous Text Reader View */}
                <div 
                    ref={transcriptRef}
                    onMouseUp={handleTextMouseUp}
                    className="relative overflow-y-auto custom-scrollbar p-6 flex-1 max-h-[500px] leading-relaxed text-lg text-slate-700"
                >
                    {/* Floating Selection Menu */}
                    {selectionMenu && (
                        <div 
                            style={{ 
                                position: 'absolute', 
                                top: selectionMenu.y - 45, 
                                left: selectionMenu.x, 
                                transform: 'translateX(-50%)' 
                            }}
                            className="z-10 animate-in zoom-in-95 duration-200"
                        >
                            <button
                                onClick={handlePracticeSelection}
                                className="bg-slate-900 text-white text-xs font-medium px-4 py-2 rounded-full shadow-xl flex items-center gap-2 hover:bg-black transition-colors after:content-[''] after:absolute after:top-full after:left-1/2 after:-translate-x-1/2 after:border-4 after:border-transparent after:border-t-slate-900"
                            >
                                <Plus className="w-3 h-3" /> Practice Selection
                            </button>
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
                             {/* Render as continuous text, but wrap segments in spans to show "active" state visually */}
                             {videoData.transcript.map((seg, idx) => (
                                <span 
                                    key={seg.id}
                                    className={`transition-colors duration-200 rounded px-1 py-0.5 cursor-pointer ${
                                        activeSegment?.id === seg.id 
                                        ? 'bg-indigo-100 text-indigo-900 font-medium ring-2 ring-indigo-200' 
                                        : 'hover:bg-slate-100'
                                    }`}
                                    // Clicking a known segment acts as a shortcut to selecting it
                                    onClick={(e) => {
                                        e.stopPropagation(); // Prevent text selection logic interfering
                                        handleSegmentClick(seg);
                                    }}
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
                            onClick={() => playSegmentVideo(activeSegment.start)}
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
                            Select text in the transcript to start.
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