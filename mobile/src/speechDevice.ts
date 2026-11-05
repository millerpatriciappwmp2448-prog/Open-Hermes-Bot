import * as Speech from 'expo-speech';
import type { SpeechCallbacks } from './replySpeech';

export const maxSpeechLength = Speech.maxSpeechInputLength;
export function speakReply(text: string, callbacks: SpeechCallbacks) {
  Speech.speak(text, { rate: 1, pitch: 1, useApplicationAudioSession: false, ...callbacks });
}
export async function stopReplySpeech() { await Speech.stop(); }
