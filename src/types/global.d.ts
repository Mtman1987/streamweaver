// Global type declarations for StreamWeaver

declare module 'node-fetch';

declare module '@google/generative-ai' {
  export class GoogleGenerativeAI {
    constructor(apiKey: string);
    getGenerativeModel(config: { model: string }): {
      generateContent(prompt: string): Promise<{
        response: {
          text(): string;
        };
      }>;
    };
  }
}