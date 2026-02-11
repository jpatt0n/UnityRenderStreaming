const RNNOISE_WORKLET_PROCESSOR_NAME = '@sapphi-red/web-noise-suppressor/rnnoise';
const RNNOISE_SAMPLE_RATE = 48000;
const WASM_SIMD_PROBE_BYTES = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123,
  3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11
]);

function supportsRnnoiseAudioWorklet() {
  return typeof window !== 'undefined' &&
    typeof window.AudioContext !== 'undefined' &&
    typeof window.AudioWorkletNode !== 'undefined';
}

async function supportsWasmSimd() {
  return typeof WebAssembly !== 'undefined' &&
    typeof WebAssembly.validate === 'function' &&
    WebAssembly.validate(WASM_SIMD_PROBE_BYTES);
}

async function fetchWasmBinary(url) {
  const response = await fetch(url, { cache: 'force-cache' });
  if (!response.ok) {
    throw new Error(`Failed to load RNNoise wasm from ${url}.`);
  }
  return await response.arrayBuffer();
}

class RnnoiseProcessor {
  constructor({ audioContext, sourceNode, processorNode, destinationNode, inputTrack, outputTrack }) {
    this.audioContext = audioContext;
    this.sourceNode = sourceNode;
    this.processorNode = processorNode;
    this.destinationNode = destinationNode;
    this.inputTrack = inputTrack;
    this.outputTrack = outputTrack;
    this.closed = false;
    this.errorHandler = null;
    this._processorErrorListener = () => {
      if (typeof this.errorHandler === 'function') {
        this.errorHandler(new Error('RNNoise AudioWorklet processor failed.'));
      }
    };
    if (this.processorNode && this.processorNode.addEventListener) {
      this.processorNode.addEventListener('processorerror', this._processorErrorListener);
    }
  }

  getTrack() {
    return this.outputTrack;
  }

  setEnabled(enabled) {
    if (this.outputTrack) {
      this.outputTrack.enabled = enabled;
    }
    if (this.inputTrack) {
      this.inputTrack.enabled = enabled;
    }
  }

  setOnError(handler) {
    this.errorHandler = handler;
  }

  async close(options = {}) {
    if (this.closed) {
      return;
    }
    this.closed = true;
    const stopInputTrack = options.stopInputTrack !== false;

    if (this.processorNode && this.processorNode.removeEventListener) {
      this.processorNode.removeEventListener('processorerror', this._processorErrorListener);
    }

    if (this.processorNode && this.processorNode.port) {
      this.processorNode.port.postMessage('destroy');
    }

    try {
      this.sourceNode && this.sourceNode.disconnect();
      this.processorNode && this.processorNode.disconnect();
      this.destinationNode && this.destinationNode.disconnect();
    } catch {
      // Ignore disconnect errors during teardown.
    }

    if (this.outputTrack) {
      this.outputTrack.stop();
      this.outputTrack = null;
    }

    if (stopInputTrack && this.inputTrack) {
      this.inputTrack.stop();
      this.inputTrack = null;
    }

    if (this.audioContext) {
      await this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
  }
}

export async function createRnnoiseProcessor(inputStream, config = {}) {
  if (!supportsRnnoiseAudioWorklet()) {
    throw new Error('AudioWorklet is not supported in this browser.');
  }

  const inputTrack = inputStream.getAudioTracks()[0];
  if (!inputTrack) {
    throw new Error('No input audio track is available for RNNoise.');
  }

  const workletPath = config.workletPath;
  if (!workletPath) {
    throw new Error('RNNoise worklet path is not configured.');
  }

  const preferSimd = config.preferSimd !== false;
  const maxChannels = Number.isFinite(config.maxChannels)
    ? Math.max(1, Math.floor(config.maxChannels))
    : 1;

  let audioContext = null;
  let sourceNode = null;
  let processorNode = null;
  let destinationNode = null;

  try {
    audioContext = new AudioContext({
      sampleRate: RNNOISE_SAMPLE_RATE,
      latencyHint: 'interactive'
    });
    await audioContext.audioWorklet.addModule(workletPath);

    const useSimd = preferSimd && await supportsWasmSimd();
    const wasmPath = useSimd && config.simdWasmPath ? config.simdWasmPath : config.wasmPath;
    if (!wasmPath) {
      throw new Error('RNNoise wasm path is not configured.');
    }
    const wasmBinary = await fetchWasmBinary(wasmPath);

    sourceNode = audioContext.createMediaStreamSource(inputStream);
    destinationNode = audioContext.createMediaStreamDestination();
    processorNode = new AudioWorkletNode(audioContext, RNNOISE_WORKLET_PROCESSOR_NAME, {
      channelCount: 1,
      channelCountMode: 'explicit',
      channelCountInterpretation: 'speakers',
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: {
        maxChannels,
        wasmBinary
      }
    });

    sourceNode.connect(processorNode);
    processorNode.connect(destinationNode);

    if (audioContext.state !== 'running') {
      await audioContext.resume().catch(() => {});
      if (audioContext.state !== 'running') {
        throw new Error('AudioContext did not enter running state for RNNoise.');
      }
    }

    const outputTrack = destinationNode.stream.getAudioTracks()[0];
    if (!outputTrack) {
      throw new Error('RNNoise did not produce an output audio track.');
    }

    return new RnnoiseProcessor({
      audioContext,
      sourceNode,
      processorNode,
      destinationNode,
      inputTrack,
      outputTrack
    });
  } catch (error) {
    if (processorNode && processorNode.port) {
      processorNode.port.postMessage('destroy');
    }
    try {
      sourceNode && sourceNode.disconnect();
      processorNode && processorNode.disconnect();
      destinationNode && destinationNode.disconnect();
    } catch {
      // Ignore disconnect errors in fallback path.
    }
    if (audioContext) {
      await audioContext.close().catch(() => {});
    }
    throw error;
  }
}
