function parseStreamChunks(buffer: string): { objects: any[]; remaining: string } {
  let braceCount = 0;
  let inString = false;
  let escapeNext = false;
  let startIdx = -1;
  const objects: any[] = [];
  let lastEndIdx = 0;

  for (let i = 0; i < buffer.length; i++) {
    const char = buffer[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') {
        if (braceCount === 0) {
          startIdx = i;
        }
        braceCount++;
      } else if (char === '}') {
        braceCount--;
        if (braceCount === 0 && startIdx !== -1) {
          const jsonStr = buffer.slice(startIdx, i + 1);
          try {
            const parsed = JSON.parse(jsonStr);
            objects.push(parsed);
          } catch (e) {
            console.error('JSON parse error:', e);
          }
          lastEndIdx = i + 1;
          startIdx = -1;
        }
      }
    }
  }

  return {
    objects,
    remaining: buffer.slice(lastEndIdx)
  };
}

// Test string
const sample = `[{
  "candidates": [{"content": {"parts": [{"text": "Hello {world}"}]}}]
},
{
  "candidates": [{"content": {"parts": [{"text": " and {more} braces!"}]}}]
}]`;

const result = parseStreamChunks(sample);
console.log('Parsed objects:', JSON.stringify(result.objects, null, 2));
console.log('Remaining:', result.remaining);
