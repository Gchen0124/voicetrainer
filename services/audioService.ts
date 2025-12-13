import { PitchData } from '../types';

export const decodeAudioData = async (
  audioCtx: AudioContext,
  blob: Blob
): Promise<AudioBuffer> => {
  const arrayBuffer = await blob.arrayBuffer();
  return await audioCtx.decodeAudioData(arrayBuffer);
};

export const decodeFileToAudioBuffer = async (file: File): Promise<AudioBuffer> => {
    const tempCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
    tempCtx.close();
    return audioBuffer;
};

export const sliceAudioBuffer = (buffer: AudioBuffer, start: number, duration: number): AudioBuffer | null => {
    const sampleRate = buffer.sampleRate;
    const startSample = Math.floor(start * sampleRate);
    const endSample = Math.floor((start + duration) * sampleRate);
    
    if (startSample >= buffer.length) return null;
    
    const length = Math.min(endSample, buffer.length) - startSample;
    if (length <= 0) return null;

    const newBuffer = new AudioBuffer({
        length: length,
        numberOfChannels: 1, // Pitch detection only needs mono
        sampleRate: sampleRate
    });
    
    // Copy data (mix down to mono if needed, or just take channel 0)
    const channelData = buffer.getChannelData(0);
    const newChannelData = newBuffer.getChannelData(0);
    
    for (let i = 0; i < length; i++) {
        newChannelData[i] = channelData[startSample + i];
    }
    
    return newBuffer;
};

// Resample audio to 16kHz Mono for efficient processing
export const getResampledAudioBuffer = async (videoFile: File): Promise<AudioBuffer | null> => {
    try {
        const tempCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const arrayBuffer = await videoFile.arrayBuffer();
        const originalBuffer = await tempCtx.decodeAudioData(arrayBuffer);
        
        // Target settings for speech recognition optimization
        const targetSampleRate = 16000;
        const targetChannels = 1;
        
        // Offline context for efficient resampling
        const offlineCtx = new OfflineAudioContext(
            targetChannels,
            originalBuffer.duration * targetSampleRate,
            targetSampleRate
        );
        
        const source = offlineCtx.createBufferSource();
        source.buffer = originalBuffer;
        source.connect(offlineCtx.destination);
        source.start();
        
        const resampledBuffer = await offlineCtx.startRendering();
        tempCtx.close();
        
        return resampledBuffer;
    } catch (e) {
        console.error("Error resampling audio:", e);
        return null;
    }
};

// Convert AudioBuffer to Base64 WAV string
export const audioBufferToBase64Wav = async (buffer: AudioBuffer): Promise<string> => {
    const wavBlob = audioBufferToWav(buffer);
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(wavBlob);
        reader.onloadend = () => {
            const base64data = reader.result as string;
            // Remove data URL prefix
            if (base64data.includes(',')) {
                resolve(base64data.split(',')[1]);
            } else {
                resolve(base64data);
            }
        };
        reader.onerror = reject;
    });
}

// WAV encoder
function audioBufferToWav(buffer: AudioBuffer): Blob {
    const numOfChan = buffer.numberOfChannels;
    const length = buffer.length * numOfChan * 2 + 44;
    const bufferArr = new ArrayBuffer(length);
    const view = new DataView(bufferArr);
    const channels = [];
    let i: number;
    let sample: number;
    let offset = 0;
    let pos = 0;
  
    // write WAVE header
    setUint32(0x46464952); // "RIFF"
    setUint32(length - 8); // file length - 8
    setUint32(0x45564157); // "WAVE"
  
    setUint32(0x20746d66); // "fmt " chunk
    setUint32(16); // length = 16
    setUint16(1); // PCM (uncompressed)
    setUint16(numOfChan);
    setUint32(buffer.sampleRate);
    setUint32(buffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
    setUint16(numOfChan * 2); // block-align
    setUint16(16); // 16-bit
  
    setUint32(0x61746164); // "data" - chunk
    setUint32(length - pos - 4); // chunk length
  
    // write interleaved data
    for (i = 0; i < buffer.numberOfChannels; i++)
      channels.push(buffer.getChannelData(i));
  
    while (pos < buffer.length) {
      for (i = 0; i < numOfChan; i++) {
        // interleave channels
        sample = Math.max(-1, Math.min(1, channels[i][pos])); // clamp
        sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0; // scale to 16-bit signed int
        view.setInt16(44 + offset, sample, true); // write 16-bit sample
        offset += 2;
      }
      pos++;
    }
  
    return new Blob([bufferArr], { type: 'audio/wav' });
  
    function setUint16(data: number) {
      view.setUint16(pos, data, true);
      pos += 2;
    }
  
    function setUint32(data: number) {
      view.setUint32(pos, data, true);
      pos += 4;
    }
  }

// Simple pitch detection using Autocorrelation
export const detectPitch = (audioBuffer: AudioBuffer): number[] => {
  const bufferLength = audioBuffer.length;
  const sampleRate = audioBuffer.sampleRate;
  const data = audioBuffer.getChannelData(0);
  
  // Downsample for performance (process every Nth chunk)
  const windowSize = 1024; // Samples per window
  const hopSize = 512; // Overlap
  const frequencies: number[] = [];

  for (let i = 0; i < bufferLength - windowSize; i += hopSize) {
    const slice = data.slice(i, i + windowSize);
    const pitch = autoCorrelate(slice, sampleRate);
    // Filter out silence/noise (very low volume or extreme frequencies)
    if (pitch === -1 || pitch > 1000 || pitch < 50) {
      frequencies.push(0); 
    } else {
      frequencies.push(pitch);
    }
  }

  return frequencies;
};

// Autocorrelation algorithm
function autoCorrelate(buffer: Float32Array, sampleRate: number): number {
  let size = buffer.length;
  let rms = 0;

  for (let i = 0; i < size; i++) {
    const val = buffer[i];
    rms += val * val;
  }
  rms = Math.sqrt(rms / size);

  // Noise gate
  if (rms < 0.01) { 
    return -1;
  }

  let r1 = 0;
  let r2 = size - 1;
  const threshold = 0.2;

  // Autocorrelation
  for (let i = 0; i < size / 2; i++) {
    if (Math.abs(buffer[i]) < threshold) {
      r1 = i;
      break;
    }
  }

  for (let i = 1; i < size / 2; i++) {
    if (Math.abs(buffer[size - i]) < threshold) {
      r2 = size - i;
      break;
    }
  }

  const part = buffer.slice(r1, r2);
  size = part.length;

  const c = new Array(size).fill(0);
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size - i; j++) {
      c[i] = c[i] + part[j] * part[j + i];
    }
  }

  let d = 0;
  while (c[d] > c[d + 1]) d++;
  let maxval = -1;
  let maxpos = -1;

  for (let i = d; i < size; i++) {
    if (c[i] > maxval) {
      maxval = c[i];
      maxpos = i;
    }
  }

  let T0 = maxpos;

  // Parabolic interpolation for better precision
  const x1 = c[T0 - 1];
  const x2 = c[T0];
  const x3 = c[T0 + 1];
  const a = (x1 + x3 - 2 * x2) / 2;
  const b = (x3 - x1) / 2;
  if (a) T0 = T0 - b / (2 * a);

  return sampleRate / T0;
}

export const normalizePitchData = (data: number[]): number[] => {
    // Remove zeros for calculation
    const nonZero = data.filter(n => n > 0);
    if (nonZero.length === 0) return data;

    const min = Math.min(...nonZero);
    const max = Math.max(...nonZero);
    
    // Normalize to 0-1 range for visualization, keeping 0 as 0 (silence)
    return data.map(v => (v === 0 ? 0 : (v - min) / (max - min)));
};