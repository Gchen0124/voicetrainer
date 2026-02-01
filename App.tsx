
import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, Volume2, Video as VideoIcon, Activity, AlertCircle, Plus, Clock, Youtube, RotateCcw, Upload, FileVideo, Loader2, Play, Trash2, History, MousePointerClick, Check, Globe, Languages, ArrowRight, Sparkles, RefreshCw, Trophy, MessageSquare, BookOpen, Search, Eye, EyeOff, LayoutList, Zap, Headphones, BookOpenText, GraduationCap } from 'lucide-react';
import VideoPlayer from './components/VideoPlayer';
import PitchVisualizer from './components/PitchVisualizer';
import { DEMO_VIDEO } from './constants';
import { TranscriptSegment, VideoData, AudioRecording, PronunciationFeedback } from './types';
import { decodeAudioData, detectPitch, getResampledAudioBuffer, sliceAudioBuffer, audioBufferToBase64Wav } from './services/audioService';
import { generateTranscript, translateSegments, generateNativeSpeech, evaluatePronunciation, fetchYouTubeTranscript } from './services/geminiService';

const LANGUAGES = ["Chinese", "Spanish", "French", "German", "Japanese", "Korean", "Portuguese", "Italian", "Hindi", "Arabic", "Russian", "Vietnamese"];

const App: React.FC = () => {
  const [videoData, setVideoData] = useState<VideoData>(DEMO_VIDEO);
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const [motherTongue, setMotherTongue] = useState<string>("Chinese");
  const [isRecording, setIsRecording] = useState(false);
  const [recordings, setRecordings] = useState<AudioRecording[]>([]);
  const [referencePitch, setReferencePitch] = useState<number[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string>('');
  const [fullAudioBuffer, setFullAudioBuffer] = useState<AudioBuffer | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [lastFeedback, setLastFeedback] = useState<PronunciationFeedback | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [userTranslationAttempt, setUserTranslationAttempt] = useState('');
  const [viewMode, setViewMode] = useState<'practice' | 'read'>('practice');
  const [showOriginalInReadMode, setShowOriginalInReadMode] = useState(false);

  const playerRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 24000});
    return () => audioContextRef.current?.close();
  }, []);

  const activeSegment = videoData.transcript.find(s => s.id === activeSegmentId) || null;
  const hasTranslations = videoData.transcript.length > 0 && videoData.transcript.every(s => !!s.translation);

  const handleLoadYouTube = async () => {
    const extractId = (url: string) => {
        const match = url.match(/^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/);
        return (match && match[2].length === 11) ? match[2] : null;
    };
    const id = extractId(urlInput);
    if (!id) return;

    setIsProcessing(true);
    resetSession();
    try {
        // Step 1: Set video data immediately so player loads
        setVideoData({ id: Date.now().toString(), title: `YouTube Video (${id})`, videoId: id, transcript: [] });
        setUrlInput('');

        // Step 2: Fetch English transcript
        setProcessingStatus('Fetching English captions...');
        const segments = await fetchYouTubeTranscript(id);

        if (segments.length === 0) {
            throw new Error('No captions available for this video');
        }

        // Step 3: Translate to user's mother tongue
        setProcessingStatus(`Translating to ${motherTongue}...`);
        const translated = await translateSegments(segments, motherTongue);

        // Step 4: Update with translated transcript
        setVideoData(prev => ({
            ...prev,
            transcript: translated
        }));
    } catch (e) {
        const errorMsg = e instanceof Error ? e.message : 'Failed to fetch video details.';
        alert(errorMsg);
    } finally {
        setIsProcessing(false);
        setProcessingStatus('');
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsProcessing(true);
    setProcessingStatus('Extracting audio...');
    try {
        const videoUrl = URL.createObjectURL(file);
        const resampledBuffer = await getResampledAudioBuffer(file);
        if (resampledBuffer) {
            setFullAudioBuffer(resampledBuffer);
            setVideoData({ 
                id: Date.now().toString(), 
                title: file.name, 
                videoUrl, 
                transcript: [] 
            });
            resetSession();
        }
    } catch (e) { alert("Failed to process file"); }
    finally { setIsProcessing(false); setProcessingStatus(''); }
  };

  const resetSession = () => {
      setActiveSegmentId(null);
      setRecordings([]);
      setLastFeedback(null);
      setReferencePitch([]);
      setUserTranslationAttempt('');
  };

  const handleSegmentClick = (segment: TranscriptSegment) => {
    setActiveSegmentId(segment.id);
    setLastFeedback(null);
    setUserTranslationAttempt(segment.userTranslationAttempt || '');
    
    if (fullAudioBuffer) {
        const slice = sliceAudioBuffer(fullAudioBuffer, segment.start, segment.duration);
        if (slice) setReferencePitch(detectPitch(slice));
    } else {
        setReferencePitch([]);
    }
  };

  const playNative = async () => {
    if (activeSegment && playerRef.current) {
        playerRef.current.seekTo(activeSegment.start, true);
        playerRef.current.playVideo();
        setTimeout(() => playerRef.current.pauseVideo(), activeSegment.duration * 1000);
    }
  };

  const playUserRecording = () => {
      if (recordings.length > 0) {
          const audio = new Audio(recordings[0].url);
          audio.play();
      }
  };

  const revealOriginal = (id: string) => {
      setVideoData(prev => ({
          ...prev,
          transcript: prev.transcript.map(s => s.id === id ? { 
              ...s, 
              isRevealed: true, 
              userTranslationAttempt: userTranslationAttempt 
          } : s)
      }));
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => audioChunksRef.current.push(e.data);
      mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        
        if (activeSegment) {
            setEvaluating(true);
            try {
                const audioBuffer = await decodeAudioData(audioContextRef.current!, blob);
                const pitch = detectPitch(audioBuffer);
                const newRec: AudioRecording = {
                    id: Date.now().toString(),
                    blob,
                    url,
                    timestamp: Date.now(),
                    segmentId: activeSegment.id,
                    pitchData: pitch,
                    duration: audioBuffer.duration
                };
                setRecordings([newRec]); // Only keep the latest for the current session

                const wavBase64 = await audioBufferToBase64Wav(audioBuffer);
                const feedback = await evaluatePronunciation(wavBase64, activeSegment.text);
                setLastFeedback(feedback);
            } catch (err) { console.error(err); }
            finally { setEvaluating(false); }
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) { alert("Microphone access denied"); }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-2">
          <div className="bg-indigo-600 p-2 rounded-lg shadow-md shadow-indigo-100">
            <Languages className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-800 tracking-tight leading-none">AccentAI</h1>
            <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest">Shadowing Trainer</span>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-full border border-slate-200">
                <Globe className="w-4 h-4 text-slate-400" />
                <span className="text-xs font-bold text-slate-500 uppercase tracking-tighter">Practice:</span>
                <select 
                    value={motherTongue} 
                    onChange={(e) => setMotherTongue(e.target.value)}
                    className="bg-transparent text-sm font-bold text-indigo-600 focus:outline-none cursor-pointer"
                >
                    {LANGUAGES.map(lang => <option key={lang} value={lang}>{lang}</option>)}
                </select>
            </div>
            <div className="h-6 w-px bg-slate-200 mx-1"></div>
            <div className="flex gap-2">
                <div className="relative flex items-center group">
                    <input 
                        type="text" 
                        placeholder="Paste YouTube Link..." 
                        className="pl-4 pr-10 py-2 border border-slate-200 rounded-xl text-sm w-72 focus:ring-4 focus:ring-indigo-50 focus:border-indigo-500 transition-all outline-none bg-slate-50 group-hover:bg-white"
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                    />
                    <button 
                        onClick={handleLoadYouTube}
                        disabled={!urlInput || isProcessing}
                        className="absolute right-2 p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors disabled:opacity-50"
                    >
                        {isProcessing ? <Loader2 className="w-5 h-5 animate-spin text-indigo-600" /> : <Search className="w-5 h-5" />}
                    </button>
                </div>
                <button 
                    onClick={() => document.getElementById('file-upload')?.click()}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-xl text-sm font-bold hover:bg-black transition-all shadow-lg shadow-slate-200 active:scale-95"
                >
                    <Upload className="w-4 h-4" /> Upload
                </button>
                <input id="file-upload" type="file" accept="video/*,audio/*" className="hidden" onChange={handleFileUpload} />
            </div>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          <div className="max-w-4xl mx-auto space-y-8">
            <VideoPlayer 
                videoId={videoData.videoId} 
                videoUrl={videoData.videoUrl} 
                onReady={(p) => playerRef.current = p}
                startTime={activeSegment?.start}
            />

            {activeSegment ? (
              <div className="bg-white rounded-3xl border border-slate-200 p-10 shadow-xl shadow-slate-200/50 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex justify-between items-start">
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse"></span>
                            <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Training Session</span>
                        </div>
                        <h2 className="text-3xl font-black text-slate-900 leading-tight">
                            {activeSegment.translation || activeSegment.text}
                        </h2>
                    </div>
                    <button onClick={() => resetSession()} className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-all"><RotateCcw className="w-6 h-6" /></button>
                </div>

                <div className="space-y-6">
                    <div className="space-y-2">
                        <label className="flex items-center gap-2 text-xs font-black text-slate-500 uppercase tracking-widest">
                            <MessageSquare className="w-3 h-3" /> Your English Translation
                        </label>
                        <textarea 
                            className="w-full p-6 border-2 border-slate-100 rounded-2xl bg-slate-50 text-xl font-medium focus:ring-4 focus:ring-indigo-50 focus:border-indigo-500 focus:bg-white transition-all outline-none resize-none min-h-[120px]"
                            placeholder="How would you say this in English? Type here..."
                            value={userTranslationAttempt}
                            onChange={(e) => setUserTranslationAttempt(e.target.value)}
                            disabled={activeSegment.isRevealed}
                        />
                    </div>
                    
                    {!activeSegment.isRevealed ? (
                        <button 
                            onClick={() => revealOriginal(activeSegment.id)}
                            className="w-full py-5 bg-indigo-600 text-white rounded-2xl font-black text-xl hover:bg-indigo-700 shadow-xl shadow-indigo-200 flex items-center justify-center gap-3 transition-all active:scale-[0.98]"
                        >
                            <Eye className="w-6 h-6" /> Compare with Original
                        </button>
                    ) : (
                        <div className="p-6 bg-emerald-50 border-2 border-emerald-100 rounded-2xl space-y-4 animate-in fade-in zoom-in-95 duration-300">
                            <div className="flex justify-between items-center">
                                <span className="text-xs font-black text-emerald-600 uppercase tracking-widest flex items-center gap-2">
                                    <Trophy className="w-4 h-4" /> Original Native Sentence
                                </span>
                                <button 
                                    onClick={playNative} 
                                    className="px-4 py-2 bg-white text-emerald-700 hover:bg-emerald-100 rounded-full flex items-center gap-2 text-xs font-black shadow-sm transition-all active:scale-95"
                                >
                                    <Volume2 className="w-4 h-4" /> Listen to Native
                                </button>
                            </div>
                            <p className="text-2xl font-bold text-slate-800 leading-relaxed italic">"{activeSegment.text}"</p>
                        </div>
                    )}
                </div>

                {activeSegment.isRevealed && (
                    <div className="pt-8 border-t-2 border-slate-50 flex flex-col gap-8">
                        <div className="flex flex-col items-center gap-4">
                            {!isRecording ? (
                                <button 
                                    onClick={startRecording}
                                    className="group flex flex-col items-center gap-4"
                                >
                                    <div className="w-24 h-24 rounded-full bg-red-500 flex items-center justify-center text-white shadow-2xl shadow-red-200 hover:bg-red-600 transition-all hover:scale-110 active:scale-90 group-hover:ring-8 group-hover:ring-red-50">
                                        <Mic className="w-10 h-10" />
                                    </div>
                                    <span className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] group-hover:text-red-500 transition-colors">Start Recording</span>
                                </button>
                            ) : (
                                <button 
                                    onClick={stopRecording}
                                    className="group flex flex-col items-center gap-4"
                                >
                                    <div className="w-24 h-24 rounded-full bg-slate-900 flex items-center justify-center text-white shadow-2xl animate-pulse hover:bg-black transition-all scale-110">
                                        <Square className="w-10 h-10" />
                                    </div>
                                    <span className="text-xs font-black text-red-500 uppercase tracking-[0.2em]">Stop and Analyze</span>
                                </button>
                            )}
                        </div>

                        {evaluating && (
                            <div className="flex flex-col items-center gap-4 py-8">
                                <div className="relative">
                                    <div className="absolute inset-0 bg-indigo-400 blur-xl opacity-20 animate-pulse"></div>
                                    <Loader2 className="w-12 h-12 text-indigo-600 animate-spin relative z-10" />
                                </div>
                                <div className="text-center">
                                    <p className="font-black text-slate-800 uppercase tracking-widest text-sm">Analyzing Pronunciation</p>
                                    <p className="text-xs text-slate-400 font-bold">Checking phonemes and intonation...</p>
                                </div>
                            </div>
                        )}

                        {lastFeedback && !evaluating && (
                            <div className="space-y-8 animate-in fade-in slide-in-from-top-4 duration-500">
                                <div className="flex flex-col gap-2">
                                    <div className="flex items-center justify-between px-2">
                                        <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Pitch Comparison</span>
                                        <button 
                                            onClick={playUserRecording}
                                            className="flex items-center gap-2 px-3 py-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-full text-[10px] font-black transition-all active:scale-95 border border-red-100"
                                        >
                                            <Headphones className="w-3.5 h-3.5" /> Play My Voice
                                        </button>
                                    </div>
                                    <PitchVisualizer 
                                        userPitch={recordings[0]?.pitchData || []} 
                                        referencePitch={referencePitch}
                                    />
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                                    <div className="md:col-span-3 bg-gradient-to-br from-indigo-600 to-violet-700 rounded-3xl p-8 text-white flex flex-col items-center justify-center shadow-2xl shadow-indigo-100 transform hover:rotate-1 transition-transform">
                                        <div className="text-[10px] font-black opacity-70 uppercase tracking-widest mb-1">Accent Score</div>
                                        <div className="text-6xl font-black">{lastFeedback.score}</div>
                                        <div className="mt-4 flex gap-1">
                                            {[1,2,3,4,5].map(i => (
                                                <div key={i} className={`w-1.5 h-1.5 rounded-full ${i <= Math.ceil(lastFeedback.score/20) ? 'bg-white' : 'bg-white/20'}`}></div>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="md:col-span-9 bg-slate-900 rounded-3xl p-8 text-white space-y-6 shadow-2xl shadow-slate-200">
                                        <div className="flex items-center justify-between">
                                            <h4 className="flex items-center gap-2 font-black text-indigo-400 uppercase tracking-widest text-xs">
                                                <Sparkles className="w-4 h-4" /> Accent Coaching
                                            </h4>
                                            <div className="text-[10px] font-bold text-slate-500 italic">Analysis powered by Gemini</div>
                                        </div>
                                        <p className="text-slate-300 leading-relaxed font-medium">{lastFeedback.generalTips}</p>
                                        <div className="flex flex-wrap gap-2 pt-2">
                                            {lastFeedback.words.map((w, idx) => (
                                                <div key={idx} className={`px-3 py-1.5 rounded-xl text-xs font-black border transition-colors ${
                                                    w.accuracy === 'correct' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' :
                                                    w.accuracy === 'near' ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' : 
                                                    'bg-red-500/10 border-red-500/30 text-red-400'
                                                }`}>
                                                    {w.word}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
              </div>
            ) : (
              <div className="bg-white border-4 border-dashed border-slate-200 rounded-[3rem] p-10 flex flex-col items-center text-center space-y-6 animate-in fade-in duration-700">
                {!hasTranslations ? (
                   <div className="space-y-6 w-full">
                     <div className="w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center border-2 border-indigo-100 shadow-inner mx-auto">
                        <Zap className="w-8 h-8 text-indigo-600 animate-pulse" />
                    </div>
                    <div className="max-w-md mx-auto space-y-2">
                        <h3 className="text-2xl font-black text-slate-800">Ready to Learn?</h3>
                        <p className="text-slate-500 font-medium leading-relaxed text-sm">
                            Paste a YouTube URL above to fetch captions and translate them into <span className="text-indigo-600 font-bold">{motherTongue}</span>.
                        </p>
                    </div>
                   </div>
                ) : (
                    <div className="w-full space-y-6">
                        {/* Header */}
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-200">
                                    <BookOpen className="w-6 h-6 text-white" />
                                </div>
                                <div className="text-left">
                                    <h3 className="text-xl font-black text-slate-800">Content Preview</h3>
                                    <p className="text-xs text-slate-500 font-medium">{videoData.transcript.length} segments in {motherTongue}</p>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <div className="flex flex-col items-center gap-1">
                                    <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600"><Volume2 className="w-4 h-4"/></div>
                                    <span className="text-[8px] font-bold text-slate-400">Listen</span>
                                </div>
                                <div className="flex flex-col items-center gap-1">
                                    <div className="p-2 bg-red-50 rounded-lg text-red-500"><Mic className="w-4 h-4"/></div>
                                    <span className="text-[8px] font-bold text-slate-400">Record</span>
                                </div>
                                <div className="flex flex-col items-center gap-1">
                                    <div className="p-2 bg-emerald-50 rounded-lg text-emerald-500"><Activity className="w-4 h-4"/></div>
                                    <span className="text-[8px] font-bold text-slate-400">Analyze</span>
                                </div>
                            </div>
                        </div>

                        {/* Full Translation Preview */}
                        <div className="bg-gradient-to-br from-slate-50 to-indigo-50/50 rounded-2xl p-6 border border-slate-200 text-left max-h-[400px] overflow-y-auto custom-scrollbar">
                            <div className="flex items-center gap-2 mb-4 sticky top-0 bg-gradient-to-br from-slate-50 to-indigo-50/50 py-2">
                                <Globe className="w-4 h-4 text-indigo-600" />
                                <span className="text-xs font-black text-indigo-600 uppercase tracking-widest">Full {motherTongue} Translation</span>
                            </div>
                            <div className="space-y-3 text-slate-700 leading-relaxed">
                                {videoData.transcript.map((seg, idx) => (
                                    <p key={seg.id} className="text-sm">
                                        {seg.translation || `[翻译中...]`}
                                    </p>
                                ))}
                            </div>
                        </div>

                        {/* CTA */}
                        <div className="bg-indigo-600 rounded-2xl p-6 text-white text-center">
                            <p className="text-sm font-medium opacity-90 mb-3">Ready to practice? Select a sentence from the panel on the right →</p>
                            <div className="flex items-center justify-center gap-2 text-xs font-black opacity-70">
                                <MousePointerClick className="w-4 h-4" />
                                <span>Click any segment to start shadowing</span>
                            </div>
                        </div>
                    </div>
                )}
              </div>
            )}
          </div>
        </div>

        <aside className="w-[420px] bg-white border-l border-slate-200 flex flex-col h-full relative shadow-2xl">
            {isProcessing && (
                <div className="absolute inset-0 bg-white/95 backdrop-blur-md z-50 flex flex-col items-center justify-center p-10 text-center space-y-6">
                    <div className="relative">
                        <div className="absolute inset-0 bg-indigo-500 blur-3xl opacity-20 animate-pulse"></div>
                        <Loader2 className="w-14 h-14 text-indigo-600 animate-spin relative z-10" />
                    </div>
                    <div className="space-y-2">
                        <p className="font-black text-slate-900 text-lg uppercase tracking-widest">{processingStatus}</p>
                        <p className="text-sm text-slate-500 font-medium">Fetching verbatim subtitles and generating translations for 30+ segments...</p>
                    </div>
                </div>
            )}

            <div className="p-4 border-b border-slate-100 bg-slate-50/50 space-y-3">
                <div className="flex items-center justify-between">
                    <h3 className="font-black text-slate-800 flex items-center gap-2 text-sm uppercase tracking-widest">
                        <LayoutList className="w-4 h-4 text-indigo-600" /> Transcript
                    </h3>
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black bg-indigo-600 text-white px-2 py-0.5 rounded-full">{videoData.transcript.length}</span>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Blocks</span>
                    </div>
                </div>
                {hasTranslations && (
                    <div className="flex bg-slate-100 rounded-xl p-1">
                        <button
                            onClick={() => setViewMode('practice')}
                            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all ${
                                viewMode === 'practice'
                                    ? 'bg-white text-indigo-600 shadow-sm'
                                    : 'text-slate-500 hover:text-slate-700'
                            }`}
                        >
                            <GraduationCap className="w-3.5 h-3.5" />
                            Practice
                        </button>
                        <button
                            onClick={() => setViewMode('read')}
                            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all ${
                                viewMode === 'read'
                                    ? 'bg-white text-indigo-600 shadow-sm'
                                    : 'text-slate-500 hover:text-slate-700'
                            }`}
                        >
                            <BookOpenText className="w-3.5 h-3.5" />
                            Read Full
                        </button>
                    </div>
                )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                {videoData.transcript.length === 0 ? (
                    <div className="text-center py-32 text-slate-300 space-y-6 px-10">
                        <div className="w-16 h-16 bg-slate-50 border-2 border-dashed border-slate-100 rounded-full flex items-center justify-center mx-auto">
                            <Youtube className="w-8 h-8 opacity-20" />
                        </div>
                        <p className="text-xs font-black uppercase tracking-[0.2em] leading-loose">Paste a YouTube link above or upload a video to load the interactive training script.</p>
                    </div>
                ) : viewMode === 'read' ? (
                    /* Holistic Read View - Full transcript with translations */
                    <div className="space-y-6">
                        {/* Full Translation Section */}
                        <div className="bg-gradient-to-br from-indigo-50 to-violet-50 rounded-2xl p-6 border border-indigo-100">
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2">
                                    <Globe className="w-4 h-4 text-indigo-600" />
                                    <h4 className="text-xs font-black text-indigo-600 uppercase tracking-widest">Full Translation ({motherTongue})</h4>
                                </div>
                                <button
                                    onClick={() => setShowOriginalInReadMode(!showOriginalInReadMode)}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${
                                        showOriginalInReadMode
                                        ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                                        : 'bg-slate-100 text-slate-500 border border-slate-200 hover:bg-slate-200'
                                    }`}
                                >
                                    {showOriginalInReadMode ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                    {showOriginalInReadMode ? 'Hide English' : 'Show English'}
                                </button>
                            </div>
                            <div className="space-y-3">
                                {videoData.transcript.map((seg, idx) => (
                                    <p
                                        key={seg.id}
                                        onClick={() => {
                                            if (playerRef.current) {
                                                playerRef.current.seekTo(seg.start, true);
                                                playerRef.current.playVideo();
                                            }
                                        }}
                                        className="text-sm text-slate-700 leading-relaxed cursor-pointer hover:text-indigo-600 hover:bg-white/50 rounded-lg px-2 py-1 -mx-2 transition-all"
                                    >
                                        <span className="text-[10px] font-bold text-indigo-400 mr-2">
                                            {Math.floor(seg.start / 60)}:{String(Math.floor(seg.start % 60)).padStart(2, '0')}
                                        </span>
                                        {seg.translation || `[翻译中...]`}
                                    </p>
                                ))}
                            </div>
                        </div>

                        {/* Full Original Transcript Section - Hidden by default */}
                        {showOriginalInReadMode && (
                            <div className="bg-white rounded-2xl p-6 border border-slate-200 animate-in fade-in slide-in-from-top-2 duration-300">
                                <div className="flex items-center gap-2 mb-4">
                                    <Languages className="w-4 h-4 text-slate-600" />
                                    <h4 className="text-xs font-black text-slate-600 uppercase tracking-widest">Original Transcript (English)</h4>
                                </div>
                                <div className="space-y-3">
                                    {videoData.transcript.map((seg, idx) => (
                                        <p
                                            key={seg.id}
                                            onClick={() => {
                                                if (playerRef.current) {
                                                    playerRef.current.seekTo(seg.start, true);
                                                    playerRef.current.playVideo();
                                                }
                                            }}
                                            className="text-sm text-slate-600 leading-relaxed cursor-pointer hover:text-indigo-600 hover:bg-slate-50 rounded-lg px-2 py-1 -mx-2 transition-all"
                                        >
                                            <span className="text-[10px] font-bold text-slate-400 mr-2">
                                                {Math.floor(seg.start / 60)}:{String(Math.floor(seg.start % 60)).padStart(2, '0')}
                                            </span>
                                            {seg.text}
                                        </p>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    /* Practice Mode - Interactive segment cards */
                    videoData.transcript.map((seg, idx) => (
                        <button
                            key={seg.id}
                            onClick={() => handleSegmentClick(seg)}
                            className={`w-full text-left p-5 rounded-2xl border-2 transition-all relative group ${
                                activeSegmentId === seg.id
                                ? 'bg-indigo-50 border-indigo-200 shadow-lg shadow-indigo-50 ring-2 ring-indigo-50'
                                : 'bg-white border-slate-50 hover:border-slate-200 hover:shadow-md'
                            }`}
                        >
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                                        activeSegmentId === seg.id ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-500'
                                    }`}>
                                        {Math.floor(seg.start / 60)}:{String(Math.floor(seg.start % 60)).padStart(2, '0')}
                                    </span>
                                    {seg.isRevealed && (
                                        <div className="flex items-center gap-1 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                                            <Check className="w-2.5 h-2.5 text-emerald-500" />
                                            <span className="text-[8px] font-black text-emerald-600 uppercase">Practiced</span>
                                        </div>
                                    )}
                                </div>
                                <span className="text-[10px] font-black text-slate-200 group-hover:text-slate-400">#{idx + 1}</span>
                            </div>

                            {/* Always show translation (Chinese) - this is what user sees first */}
                            <p className={`text-sm font-bold leading-relaxed mb-2 transition-colors ${
                                activeSegmentId === seg.id ? 'text-indigo-900' : 'text-slate-700'
                            }`}>
                                {seg.translation || `[翻译中...] ${seg.text.substring(0, 50)}...`}
                            </p>

                            {/* English only shows after "Compare with Original" is clicked */}
                            {seg.isRevealed && (
                                <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100 animate-in fade-in duration-300">
                                    <div className="flex items-center gap-1 mb-1">
                                        <Languages className="w-3 h-3 text-emerald-600" />
                                        <span className="text-[8px] font-black text-emerald-600 uppercase">English Original</span>
                                    </div>
                                    <p className="text-[11px] font-medium text-emerald-800 leading-normal">
                                        "{seg.text}"
                                    </p>
                                </div>
                            )}

                            {activeSegmentId === seg.id && (
                                <div className="absolute right-4 top-1/2 -translate-y-1/2">
                                    <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white shadow-lg animate-bounce">
                                        <Play className="w-4 h-4 fill-current ml-0.5" />
                                    </div>
                                </div>
                            )}
                        </button>
                    ))
                )}
            </div>
            
            <div className="p-6 border-t border-slate-100 bg-white">
                <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1">
                        <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Progress</span>
                        <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                            <div 
                                className="h-full bg-indigo-600 transition-all duration-1000" 
                                style={{ width: `${videoData.transcript.length > 0 ? (videoData.transcript.filter(s => s.isRevealed).length / videoData.transcript.length) * 100 : 0}%` }}
                            ></div>
                        </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                        <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Status</span>
                        <div className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-indigo-600"></div>
                            <span className="text-[10px] font-black text-slate-600">VERBATIM MODE</span>
                        </div>
                    </div>
                </div>
            </div>
        </aside>
      </main>
    </div>
  );
};

export default App;
