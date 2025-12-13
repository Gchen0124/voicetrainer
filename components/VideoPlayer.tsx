import React, { useRef, useEffect, useState } from 'react';
import YouTube, { YouTubeProps } from 'react-youtube';

interface VideoPlayerProps {
  videoId?: string;
  videoUrl?: string;
  onReady: (player: any) => void;
  startTime?: number;
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({ videoId, videoUrl, onReady, startTime }) => {
  const playerRef = useRef<any>(null);
  const videoTagRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset state when source changes
  useEffect(() => {
    setError(null);
  }, [videoId, videoUrl]);

  // Handle local video seeking
  useEffect(() => {
    if (videoUrl && videoTagRef.current && startTime !== undefined) {
      videoTagRef.current.currentTime = startTime;
      videoTagRef.current.play().catch(e => console.log("Auto-play prevented:", e));
    }
  }, [startTime, videoUrl]);

  // Handle YouTube seeking
  useEffect(() => {
    if (videoId && playerRef.current && startTime !== undefined && !error) {
      try {
        playerRef.current.seekTo(startTime, true);
        playerRef.current.playVideo();
      } catch (e) {
        console.error("Seek failed:", e);
      }
    }
  }, [startTime, error, videoId]);

  // --- YouTube Handlers ---
  const opts: YouTubeProps['opts'] = {
    height: '100%',
    width: '100%',
    playerVars: {
      autoplay: 0,
      modestbranding: 1,
      rel: 0,
      origin: typeof window !== 'undefined' ? window.location.origin : undefined,
    },
  };

  const handleYTReady = (event: any) => {
    playerRef.current = event.target;
    // Adapt YouTube player to match our generic interface if needed, 
    // but we pass the raw player up for now as the parent knows how to use it.
    onReady(event.target); 
    setError(null);
  };

  const handleYTError = (event: any) => {
    console.error("YouTube Player Error Code:", event.data);
    if (event.data === 101 || event.data === 150 || event.data === 153) {
        setError("This video owner has disabled playback in embedded players. Please try a different video.");
    } else {
        setError("An error occurred while loading the video.");
    }
  };

  // --- Local Video Handlers ---
  const handleLocalReady = () => {
      // Create a unified interface for the parent component
      const playerInterface = {
          seekTo: (seconds: number, allowSeekAhead: boolean) => {
              if (videoTagRef.current) {
                  videoTagRef.current.currentTime = seconds;
              }
          },
          playVideo: () => {
              videoTagRef.current?.play();
          },
          pauseVideo: () => {
              videoTagRef.current?.pause();
          },
          getCurrentTime: () => videoTagRef.current?.currentTime || 0
      };
      onReady(playerInterface);
  };

  if (videoUrl) {
      return (
        <div className="aspect-video w-full rounded-xl overflow-hidden shadow-lg bg-black relative">
            <video 
                ref={videoTagRef}
                src={videoUrl}
                className="w-full h-full object-contain"
                controls
                onLoadedMetadata={handleLocalReady}
            />
        </div>
      );
  }

  if (videoId) {
    return (
        <div className="aspect-video w-full rounded-xl overflow-hidden shadow-lg bg-black relative group">
        {error ? (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-900 text-white z-10 p-6 text-center">
                <div className="max-w-md bg-slate-800 p-6 rounded-lg border border-slate-700 shadow-xl">
                    <p className="text-red-400 font-bold mb-2 text-lg">Playback Error</p>
                    <p className="text-slate-300 mb-4">{error}</p>
                    <p className="text-xs text-slate-500">Error Code: 153/150</p>
                </div>
            </div>
        ) : null}
        <YouTube 
            videoId={videoId} 
            opts={opts} 
            onReady={handleYTReady} 
            onError={handleYTError}
            className="h-full w-full"
            iframeClassName="h-full w-full absolute inset-0"
        />
        </div>
    );
  }

  return <div className="aspect-video bg-slate-100 flex items-center justify-center text-slate-400">No Video Loaded</div>;
};

export default VideoPlayer;