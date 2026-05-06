
'use server';

import { transcribeAudio } from "@/services/speech";

export async function transcribe(audioDataUri: string): Promise<{ transcription: string; error?: string; }> {
    if (!audioDataUri) {
        return { transcription: "", error: "Audio data URI is missing." };
    }
    
    // The data URI is 'data:audio/webm;base64,<encoded_data>'
    // We need to extract just the base64 encoded data part.
    const base64Audio = audioDataUri.split(',')[1];
    if (!base64Audio) {
        return { transcription: "", error: "Invalid audio data URI format." };
    }

    try {
        const result = await transcribeAudio(base64Audio);
        return result;
    } catch (error: any) {
        console.error("Error in transcription server action:", error);
        return { transcription: "", error: error.message || "An unknown error occurred during transcription." };
    }
}
