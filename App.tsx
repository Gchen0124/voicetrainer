import React, { useState, useRef, useEffect } from 'react';
import { Mic, Play, Square, Volume2, Video as VideoIcon, Activity, AlertCircle, Wand2, Plus, Clock, Youtube, RotateCcw, Upload, FileVideo, Loader2 } from 'lucide-react';
import VideoPlayer from './components/VideoPlayer';
import PitchVisualizer from './components/PitchVisualizer';
import { DEMO_VIDEO } from './constants';
import { TranscriptSegment, VideoData, AudioRecording } from './types';
import { decodeAudioData, detectPitch, extractAudioFromVideo } from './services/audioService';
import { generateSpeechReference, analyzeAccent, generateTranscript } from './services/geminiService';

const App: React.FC = () => {
  // State
  const [videoData, setVideoData] = useState<VideoData>(DEMO_VIDEO);
  const [activeSegment, setActiveSegment] = useState<TranscriptSegment | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isInitializingRec, setIsInitializingRec] = useState(false);
  const [recordings, setRecordings] = useState<AudioRecording[]>([]);
  const [currentRecording, setCurrentRecording] = useState<AudioRecording | null>(null);
  const [analysis, setAnalysis] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [referencePitch, setReferencePitch] = useState<number[]>([]);
  const [isGeneratingRef, setIsGeneratingRef] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  
  // Custom Video State
  const [urlInput, setUrlInput] = useState('');
  const [isAddingSegment, setIsAddingSegment] = useState(false);
  const [newSegText, setNewSegText] = useState('');
  const [newSegStart, setNewSegStart] = useState<string>('');
  const [newSegDuration, setNewSegDuration] = useState<string>('5');

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
    resetSession();
    
    // Create Object URL for playback
    const videoUrl = URL.createObjectURL(file);
    
    try {
        // 1. Set Video Data basic
        setVideoData({
            id: Date.now().toString(),
            title: file.name,
            videoUrl: videoUrl,
            transcript: []
        });

        // 2. Extract Audio
        const audioBase64 = await extractAudioFromVideo(file);
        
        if (audioBase64) {
            // 3. Generate Transcript via Gemini
            const transcript = await generateTranscript(audioBase64);
            setVideoData(prev => ({
                ...prev,
                transcript: transcript
            }));
        } else {
            alert("Could not process audio from video file.");
        }
    } catch (e) {
        console.error("Upload error", e);
        alert("Error processing video file.");
    } finally {
        setIsTranscribing(false);
        // Clear input so same file can be selected again if needed
        if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const resetSession = () => {
      setActiveSegment(null);
      setAnalysis('');
      setRecordings([]);
      setCurrentRecording(null);
      setReferencePitch([]);
  }

  const handleResetDemo = () => {
      setVideoData(DEMO_VIDEO);
      resetSession();
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

      setVideoData(prev => ({
          ...prev,
          transcript: [...prev.transcript, newSegment].sort((a,b) => a.start - b.start)
      }));

      // Reset form
      setNewSegText('');
      setNewSegStart('');
      setIsAddingSegment(false);
  };

  // Handle segment selection
  const handleSegmentClick = async (segment: TranscriptSegment) => {
    setActiveSegment(segment);
    setAnalysis(''); // Clear previous analysis
    setReferencePitch([]); // Clear old reference

    // 1. Seek Video
    if (playerRef.current) {
      playerRef.current.seekTo(segment.start, true);
      // For local video, seekTo handles play. For YouTube, we might need explicit play.
      if (videoData.videoId) {
           playerRef.current.playVideo();
      }
    }

    // 2. Generate Reference Audio for Pitch Comparison (Using Gemini TTS as Native Proxy)
    setIsGeneratingRef(true);
    const refBlob = await generateSpeechReference(segment.text);
    if (refBlob && audioContextRef.current) {
        // Decode and Analyze Pitch
        try {
            const buffer = await decodeAudioData(audioContextRef.current, refBlob);
            const pitchData = detectPitch(buffer);
            setReferencePitch(pitchData);
        } catch (e) {
            console.error("Error generating reference pitch", e);
        }
    }
    setIsGeneratingRef(false);
  };

  const startRecording = async () => {
    if (!activeSegment) {
        alert("Please select a transcript line to practice first.");
        return;
    }
    
    // Ensure AudioContext is running (browsers often suspend it until user interaction)
    if (audioContextRef.current?.state === 'suspended') {
        try {
            await audioContextRef.current.resume();
        } catch (e) {
            console.error("Could not resume audio context", e);
        }
    }

    setRecordings([]); 
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
        // Use the mimeType from the recorder if available to ensure playback compatibility
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
        
        // Auto-analyze
        handleAnalyze(activeSegment.text);
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err: any) {
      console.error("Error accessing microphone:", err);
      // Give explicit instruction for the "Permission denied" persistence issue
      alert("Microphone Access Blocked.\n\nPlease click the lock icon 🔒 next to the website address in your browser bar, toggle 'Microphone' to ON (or Reset Permissions), and refresh the page.");
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
    const audio = new Audio(rec.url);
    audio.play();
  };

  const handleAnalyze = async (text: string) => {
    setIsAnalyzing(true);
    const feedback = await analyzeAccent(text);
    setAnalysis(feedback);
    setIsAnalyzing(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-6 h-6 text-indigo-600" />
            <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent hidden sm:block">AccentAI Trainer</h1>
          </div>
          
          {/* Controls */}
          <div className="flex-1 max-w-2xl mx-4 flex gap-3">
              {/* YouTube Input */}
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

              {/* Upload Button */}
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

            {/* Transcript Section */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col flex-1 min-h-[400px]">
                <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                    <div>
                        <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                            <VideoIcon className="w-4 h-4 text-slate-500" />
                            Transcript & Practice Segments
                        </h2>
                        <p className="text-xs text-slate-500 mt-1">
                            {videoData.transcript.length === 0 
                                ? "No segments yet." 
                                : "Click a sentence to practice and analyze."}
                            {isTranscribing && <span className="text-indigo-600 ml-2 animate-pulse">Auto-generating transcript...</span>}
                        </p>
                    </div>
                    <button 
                        onClick={() => setIsAddingSegment(!isAddingSegment)}
                        className={`text-xs flex items-center gap-1 px-3 py-1.5 rounded-full border transition-all ${isAddingSegment ? 'bg-indigo-100 text-indigo-700 border-indigo-200' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-600'}`}
                    >
                        <Plus className="w-3 h-3" /> {isAddingSegment ? 'Close' : 'Add Manual Segment'}
                    </button>
                </div>

                {/* Add Segment Form */}
                {isAddingSegment && (
                    <div className="p-4 bg-indigo-50 border-b border-indigo-100 animate-in slide-in-from-top-2 duration-200">
                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs font-medium text-indigo-900 mb-1">Sentence to Practice</label>
                                <input 
                                    type="text" 
                                    value={newSegText}
                                    onChange={(e) => setNewSegText(e.target.value)}
                                    placeholder="Type what you hear in the video..."
                                    className="w-full text-sm rounded-md border-indigo-200 focus:border-indigo-500 focus:ring-indigo-500"
                                />
                            </div>
                            <div className="flex gap-4">
                                <div className="flex-1">
                                    <label className="block text-xs font-medium text-indigo-900 mb-1">Start Time (sec)</label>
                                    <div className="flex gap-2">
                                        <input 
                                            type="number" 
                                            step="0.1"
                                            value={newSegStart}
                                            onChange={(e) => setNewSegStart(e.target.value)}
                                            placeholder="0.0"
                                            className="w-full text-sm rounded-md border-indigo-200 focus:border-indigo-500 focus:ring-indigo-500"
                                        />
                                        <button 
                                            onClick={handleCaptureTime}
                                            className="px-2 py-1 bg-white border border-indigo-200 rounded text-xs font-medium text-indigo-600 hover:bg-indigo-50"
                                            title="Get current video time"
                                        >
                                            <Clock className="w-4 h-4" />
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
                                <div className="flex items-end">
                                    <button 
                                        onClick={handleAddSegment}
                                        className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 shadow-sm"
                                    >
                                        Add
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                <div className="overflow-y-auto custom-scrollbar p-2 flex-1 max-h-[500px]">
                    {videoData.transcript.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-48 text-slate-400">
                             {isTranscribing ? (
                                <>
                                    <Loader2 className="w-8 h-8 mb-2 animate-spin text-indigo-500" />
                                    <p className="text-sm font-medium text-indigo-600">Generating transcript...</p>
                                    <p className="text-xs mt-1 text-slate-500">This may take a few seconds.</p>
                                </>
                             ) : (
                                <>
                                    <FileVideo className="w-8 h-8 mb-2 opacity-50" />
                                    <p className="text-sm">No transcript available.</p>
                                    <p className="text-xs mt-1">Upload a video to auto-generate one!</p>
                                </>
                             )}
                        </div>
                    ) : (
                        videoData.transcript.map((seg) => (
                            <button
                                key={seg.id}
                                onClick={() => handleSegmentClick(seg)}
                                className={`w-full text-left p-4 rounded-lg transition-all duration-200 border-l-4 mb-2 group ${
                                    activeSegment?.id === seg.id
                                    ? 'bg-indigo-50 border-indigo-500 shadow-sm'
                                    : 'hover:bg-slate-50 border-transparent hover:border-slate-300'
                                }`}
                            >
                                <p className={`text-base leading-relaxed ${activeSegment?.id === seg.id ? 'text-indigo-900 font-medium' : 'text-slate-600'}`}>
                                    {seg.text}
                                </p>
                                <div className="flex justify-between items-center mt-2">
                                    <span className="text-xs font-mono text-slate-400">{new Date(seg.start * 1000).toISOString().substr(14, 5)}</span>
                                    {activeSegment?.id === seg.id && (
                                        <span className="text-xs text-indigo-600 font-semibold flex items-center gap-1 animate-pulse">
                                            Active <div className="w-1.5 h-1.5 rounded-full bg-indigo-600"></div>
                                        </span>
                                    )}
                                </div>
                            </button>
                        ))
                    )}
                </div>
            </div>
        </div>

        {/* Right Column: Practice Area */}
        <div className="lg:col-span-5 flex flex-col gap-6">
            
            {/* Recording Controls */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                        <Mic className="w-4 h-4 text-indigo-500" />
                        Practice Studio
                    </h2>
                    {!activeSegment && (
                        <span className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded-full flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" /> Select transcript first
                        </span>
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
                        Select a line from the transcript to start practicing.
                    </div>
                )}
            </div>

            {/* Pitch Visualizer */}
            {activeSegment && (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 relative min-h-[250px] flex flex-col">
                     <div className="flex justify-between items-center mb-4">
                        <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                            <Activity className="w-4 h-4 text-emerald-500" />
                            Tone & Pitch Visualizer
                        </h2>
                        {isGeneratingRef && <span className="text-xs text-indigo-500 animate-pulse">Loading Native Reference...</span>}
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
                                {isGeneratingRef 
                                    ? "Analyzing native speech pattern..." 
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
                                <Volume2 className="w-4 h-4" /> Play My Recording
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* AI Analysis */}
            {currentRecording && (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                    <h2 className="font-semibold text-slate-800 flex items-center gap-2 mb-4">
                        <Wand2 className="w-4 h-4 text-violet-500" />
                        AI Feedback
                    </h2>
                    {isAnalyzing ? (
                         <div className="flex flex-col items-center justify-center py-8 gap-3">
                            <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                            <span className="text-sm text-slate-500">Analyzing pronunciation...</span>
                        </div>
                    ) : (
                        <div className="prose prose-sm prose-indigo max-w-none text-slate-600 bg-slate-50 p-4 rounded-lg border border-slate-100">
                             {/* Simple markdown rendering for the bullet points */}
                             {analysis.split('\n').map((line, i) => (
                                <p key={i} className="mb-1">{line}</p>
                             ))}
                        </div>
                    )}
                </div>
            )}

        </div>
      </main>
    </div>
  );
};

export default App;