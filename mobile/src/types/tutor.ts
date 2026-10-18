export type SessionStatus =
  | 'disconnected'
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking';

export type HumorIntensity = 'moderado' | 'roast';

export type CorrectionCategory =
  | 'grammar'
  | 'vocabulary'
  | 'pronunciation'
  | 'naturalness';

export interface GrammarCorrection {
  id: string;
  timestamp: string;
  userSaid: string;
  correction: string;
  explanationPt: string;
  category: CorrectionCategory;
}

export type ServerMessage =
  | {
      type: 'session_ready';
      sampleRateIn: number;
      sampleRateOut: number;
      intensity: HumorIntensity;
    }
  | {
      type: 'status';
      status: 'listening' | 'thinking' | 'speaking';
    }
  | {
      type: 'audio_output';
      data: string; // base64 PCM 24kHz 16-bit mono
      sampleRate: number;
    }
  | {
      type: 'turn_complete';
    }
  | {
      type: 'barge_in';
    }
  | {
      type: 'grammar_correction';
      correction: GrammarCorrection;
    }
  | {
      type: 'transcript';
      role: 'user' | 'tutor';
      text: string;
    }
  | {
      type: 'error';
      message: string;
    }
  | {
      type: 'pong';
      timestamp: number;
    };
