import type { DictationRecognizer } from './dictation';
import { stopReplySpeech } from './speechDevice';

/**
 * The iPhone's own speech recognizer, loaded only when the microphone is
 * pressed. Reading a reply aloud and listening share the audio session, so the
 * reply stops first. A build without the native module answers null.
 */
export async function getDictationRecognizer(): Promise<DictationRecognizer | null> {
  try { await stopReplySpeech(); } catch { /* nothing was being read */ }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const module = require('expo-speech-recognition') as { ExpoSpeechRecognitionModule?: DictationRecognizer };
    return module.ExpoSpeechRecognitionModule ?? null;
  } catch {
    return null;
  }
}
