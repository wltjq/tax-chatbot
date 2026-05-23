import { loadEnvConfig } from '@next/env';
import dotenv from 'dotenv';
loadEnvConfig(process.cwd());

async function testStream() {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = 'gemini-3.1-flash-lite';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}`;

  console.log('Sending streaming request to model:', model);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Write a short 3 sentence story.' }] }]
      })
    });

    if (!res.ok) {
      console.error('Failed:', res.status, await res.text());
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      console.error('No reader');
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
      
      // Parse JSON array items from the stream
      // Each item starts with { or ,{ and ends with }
      // A simple regex approach or JSON-like parsing can extract candidates
      console.log('--- CHUNK RECEIVED ---');
      console.log(chunk);
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

testStream();
