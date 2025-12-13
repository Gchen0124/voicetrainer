import React, { useEffect, useRef } from 'react';
import { normalizePitchData } from '../services/audioService';

interface PitchVisualizerProps {
  userPitch: number[];
  referencePitch: number[];
  width?: number;
  height?: number;
  label?: string;
}

const PitchVisualizer: React.FC<PitchVisualizerProps> = ({ 
  userPitch, 
  referencePitch,
  width = 600, 
  height = 200,
  label
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Background grid
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for(let i=0; i<width; i+=50) {
        ctx.moveTo(i, 0);
        ctx.lineTo(i, height);
    }
    for(let i=0; i<height; i+=40) {
        ctx.moveTo(0, i);
        ctx.lineTo(width, i);
    }
    ctx.stroke();

    const drawCurve = (data: number[], color: string, lineWidth: number) => {
        if (data.length === 0) return;
        
        // Normalize purely for visualization drawing
        // Note: Real comparison requires time-alignment (DTW), 
        // but here we just stretch the shorter one to match the width for visual "shape" comparison.
        const normalizedData = normalizePitchData(data);
        
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        const stepX = width / (normalizedData.length - 1);

        let started = false;
        
        for (let i = 0; i < normalizedData.length; i++) {
            const val = normalizedData[i];
            // Invert Y because canvas 0 is top
            // Map 0-1 to height-0 (with padding)
            const padding = 20;
            const y = height - padding - (val * (height - 2 * padding));
            const x = i * stepX;

            if (val === 0) {
                // Gap in voice (unvoiced or silence)
                started = false;
                continue;
            }

            if (!started) {
                ctx.moveTo(x, y);
                started = true;
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
    };

    // Draw Reference (Native)
    // We render it first, slightly transparent
    if (referencePitch.length > 0) {
       drawCurve(referencePitch, '#3b82f6', 4); // Blue
    }

    // Draw User
    if (userPitch.length > 0) {
       drawCurve(userPitch, '#ef4444', 3); // Red
    }

  }, [userPitch, referencePitch, width, height]);

  return (
    <div className="relative bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm">
        {label && <div className="absolute top-2 left-2 text-xs font-semibold text-slate-500 bg-white/80 px-2 py-1 rounded">{label}</div>}
        <div className="absolute bottom-2 right-2 flex gap-4 text-xs font-medium">
            <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-full bg-blue-500"></span> Native/Reference
            </div>
            <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-full bg-red-500"></span> You
            </div>
        </div>
        <canvas 
            ref={canvasRef} 
            width={width} 
            height={height} 
            className="w-full h-full block"
        />
    </div>
  );
};

export default PitchVisualizer;
