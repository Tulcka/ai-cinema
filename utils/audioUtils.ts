
export const getAudioDuration = async (file: File): Promise<number> => {
    const arrayBuffer = await file.arrayBuffer();
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const duration = audioBuffer.duration;
    audioContext.close();
    return duration;
};

export const trimAudio = async (file: File, startTime: number, endTime: number): Promise<Blob> => {
    const arrayBuffer = await file.arrayBuffer();
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // If no trim needed (within small margin of error), return original
    if (startTime === 0 && Math.abs(endTime - audioBuffer.duration) < 0.1) {
        return file;
    }

    const duration = endTime - startTime;
    if (duration <= 0) throw new Error("End time must be greater than start time");

    const sampleRate = audioBuffer.sampleRate;
    const length = Math.floor(duration * sampleRate);
    
    const offlineContext = new OfflineAudioContext(
        audioBuffer.numberOfChannels,
        length,
        sampleRate
    );

    const source = offlineContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineContext.destination);
    
    // Start playing at 'startTime' relative to the buffer, but schedule it at time 0 in the offline context
    source.start(0, startTime, duration);

    const renderedBuffer = await offlineContext.startRendering();
    
    return bufferToWav(renderedBuffer);
};

function bufferToWav(abuffer: AudioBuffer): Blob {
  const numOfChan = abuffer.numberOfChannels;
  const length = abuffer.length * numOfChan * 2 + 44;
  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);
  const channels = [];
  let i;
  let sample;
  let offset = 0;
  let pos = 0;

  // Helper to write data
  function setUint16(data: number) {
    view.setUint16(pos, data, true);
    pos += 2;
  }

  function setUint32(data: number) {
    view.setUint32(pos, data, true);
    pos += 4;
  }

  // RIFF identifier
  setUint32(0x46464952); // "RIFF"
  setUint32(length - 8); // file length - 8
  // RIFF type
  setUint32(0x45564157); // "WAVE"

  // format chunk identifier
  setUint32(0x20746d66); // "fmt "
  setUint32(16); // format chunk length
  setUint16(1); // sample format (raw)
  setUint16(numOfChan); // channel count
  setUint32(abuffer.sampleRate); // sample rate
  setUint32(abuffer.sampleRate * 2 * numOfChan); // byte rate (sampleRate * blockAlign)
  setUint16(numOfChan * 2); // block align (channel count * bytes per sample)
  setUint16(16); // bits per sample

  // data chunk identifier
  setUint32(0x61746164); // "data"
  setUint32(length - pos - 4); // data chunk length

  // Interleave channels
  for(i = 0; i < abuffer.numberOfChannels; i++) {
    channels.push(abuffer.getChannelData(i));
  }

  while(pos < length) {
    for(i = 0; i < numOfChan; i++) {
      // clamp
      sample = Math.max(-1, Math.min(1, channels[i][offset])); 
      // scale to 16-bit signed int
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767)|0; 
      view.setInt16(pos, sample, true); 
      pos += 2;
    }
    offset++;
  }

  return new Blob([buffer], {type: "audio/wav"});
}
