declare module 'meyda' {
  interface MeydaAnalyzerOptions {
    audioContext: AudioContext;
    source: AudioNode;
    bufferSize: number;
    featureExtractors?: string[];
    callback?: (features: Record<string, number>) => void;
  }

  interface MeydaAnalyzer {
    start(): void;
    stop(): void;
    get(): Record<string, number> | undefined;
  }

  interface MeydaStatic {
    createMeydaAnalyzer(options: MeydaAnalyzerOptions): MeydaAnalyzer;
  }

  const meyda: MeydaStatic;
  export default meyda;
}
