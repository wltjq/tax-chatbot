import { GoogleGenAI } from '@google/genai';
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

async function test() {
  const apiKey = process.env.GEMINI_API_KEY;
  console.log('API Key present:', !!apiKey);
  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: 'Hello! How are you?',
    });
    console.log('Response:', response.text);
  } catch (err) {
    console.error('Error:', err);
  }
}

test();
