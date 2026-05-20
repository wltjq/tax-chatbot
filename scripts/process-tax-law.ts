import * as fs from 'fs';
import * as path from 'path';
import { Pinecone } from '@pinecone-database/pinecone';
import * as dotenv from 'dotenv';

// Load env variables
dotenv.config({ path: '.env.local' });
dotenv.config(); // fallback to standard .env

const docPath = path.join(process.cwd(), 'data', '소득세법(법률)(제21548호)(20260421).doc');

// Custom RTF Parser translated to TS
function rtfToTextCustom(rtfContent: string): string {
  const stack: boolean[] = [];
  let skip = false;
  const out: string[] = [];
  
  let ucSkip = 1;
  let toSkip = 0;
  
  let i = 0;
  const n = rtfContent.length;
  
  const skipDestinations = new Set([
    'fonttbl', 'colortbl', 'stylesheet', 'info', 'listtable', 
    'listoverridetable', 'generator', 'footer', 'header', 'pict', 
    'shppict', 'stylesheet', 'nonshppict', 'xmlattr'
  ]);
  
  while (i < n) {
    const c = rtfContent[i];
    
    if (toSkip > 0) {
      toSkip -= 1;
      i += 1;
      continue;
    }
    
    if (c === '{') {
      stack.push(skip);
      i += 1;
    } else if (c === '}') {
      if (stack.length > 0) {
        skip = stack.pop()!;
      } else {
        skip = false;
      }
      i += 1;
    } else if (c === '\\') {
      i += 1;
      if (i >= n) break;
      
      const c2 = rtfContent[i];
      
      if (c2 === '{' || c2 === '}' || c2 === '\\') {
        if (!skip) {
          out.push(c2);
        }
        i += 1;
      } else if (c2 === '\n' || c2 === '\r') {
        i += 1;
      } else if (c2 === '\'') {
        const hexStr = rtfContent.substring(i + 1, i + 3);
        if (!skip) {
          try {
            const buf = Buffer.from(hexStr, 'hex');
            out.push(buf.toString('latin1'));
          } catch (e) {}
        }
        i += 3;
      } else {
        // Control word
        const substring = rtfContent.substring(i);
        const match = substring.match(/^([a-zA-Z*]+)(-?\d*)/);
        if (match) {
          const word = match[1];
          const param = match[2];
          const wordLen = word.length + param.length;
          i += wordLen;
          
          if (i < n && rtfContent[i] === ' ') {
            i += 1;
          }
          
          if (word === '*') {
            const match2 = rtfContent.substring(i).match(/^\\([a-zA-Z]+)/);
            if (match2) {
              const destWord = match2[1];
              if (skipDestinations.has(destWord)) {
                skip = true;
              }
            }
          } else if (skipDestinations.has(word)) {
            skip = true;
          } else if (word === 'bin') {
            try {
              const binLen = parseInt(param, 10);
              i = Math.min(n, i + binLen);
            } catch (e) {}
          } else if (!skip) {
            if (word === 'par' || word === 'line') {
              out.push('\n');
            } else if (word === 'tab') {
              out.push('\t');
            } else if (word === 'u') {
              try {
                let val = parseInt(param, 10);
                if (val < 0) {
                  val += 65536;
                }
                out.push(String.fromCharCode(val));
                toSkip = ucSkip;
              } catch (e) {}
            } else if (word === 'uc') {
              try {
                ucSkip = parseInt(param, 10);
              } catch (e) {}
            }
          }
        } else {
          if (!skip) {
            out.push(c2);
          }
          i += 1;
        }
      }
    } else {
      if (!skip) {
        out.push(c);
      }
      i += 1;
    }
  }
  
  return out.join('');
}

// Fetch batch embeddings using Pinecone Inference API (multilingual-e5-large)
async function getPineconeEmbeddingBatch(pc: Pinecone, texts: string[], retries = 5, delay = 2000): Promise<number[][]> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await pc.inference.embed({
        model: 'multilingual-e5-large',
        inputs: texts,
        parameters: { inputType: 'passage' }
      });
      
      if (!response.data) {
        throw new Error('Pinecone inference embedding response was empty.');
      }
      
      return response.data.map((e: any) => {
        if (!e.values) throw new Error('Missing values in embedding response');
        return e.values;
      });
    } catch (error) {
      if (attempt === retries - 1) throw error;
      const waitTime = delay * Math.pow(2, attempt);
      console.warn(`Pinecone batch embedding failed: ${error}. Retrying in ${(waitTime / 1000).toFixed(1)}s...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  throw new Error('Failed to get Pinecone embeddings after multiple retries.');
}


async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  const pineconeKey = process.env.PINECONE_API_KEY;
  const pineconeIndexName = process.env.PINECONE_INDEX || 'tax-chatbot';
  
  if (!apiKey || apiKey.startsWith('your_')) {
    console.error('Error: GEMINI_API_KEY is not set or is a placeholder in .env.local');
    process.exit(1);
  }
  
  if (!pineconeKey || pineconeKey.startsWith('your_')) {
    console.error('Error: PINECONE_API_KEY is not set or is a placeholder in .env.local');
    process.exit(1);
  }
  
  const mdPath = path.join(process.cwd(), 'data', '소득세법.md');
  let text = '';
  
  if (fs.existsSync(mdPath)) {
    console.log('Found data/소득세법.md. Parsing markdown directly...');
    const mdContent = fs.readFileSync(mdPath, 'utf-8');
    // Clean up markdown formatting to make regex splitting clean
    text = mdContent
      .replace(/\*\*/g, '')
      .replace(/#/g, '')
      .replace(/\r/g, '')
      .replace(/\n\s*\n/g, '\n\n');
    console.log(`Markdown parsed successfully. Cleaned text length: ${text.length} characters.`);
  } else {
    console.log('Reading tax law doc file...');
    if (!fs.existsSync(docPath)) {
      console.error(`Error: File not found at ${docPath}`);
      process.exit(1);
    }
    
    const rtfContent = fs.readFileSync(docPath, 'latin1');
    console.log(`File read successfully. Size: ${rtfContent.length} characters.`);
    
    console.log('Parsing RTF text...');
    const rawText = rtfToTextCustom(rtfContent);
    text = rawText.replace(/\r/g, '').replace(/\n\s*\n/g, '\n\n');
    console.log(`RTF parsed successfully. Extracted text length: ${text.length} characters.`);
  }
  
  // Write plain text file as backup/verification
  const txtPath = path.join(process.cwd(), 'data', '소득세법.txt');
  fs.writeFileSync(txtPath, text, 'utf-8');
  console.log(`Saved clean text to ${txtPath}`);
  
  // Chunking by articles: 제OO조 or 제OO조의OO(제목)
  console.log('Chunking text by articles...');
  const articleRegex = /(제\d+조(?:의\d+)*(?:\([^)]+\))?)/g;
  const parts = text.split(articleRegex);
  
  interface Chunk {
    id: string;
    article: string;
    title: string;
    content: string;
  }
  
  const chunks: Chunk[] = [];
  
  // parts[0] is everything before 제1조 (preamble, name of law, etc.)
  if (parts[0].trim()) {
    chunks.push({
      id: 'preamble',
      article: '서문',
      title: '소득세법 기본정보',
      content: parts[0].trim()
    });
  }
  
  for (let idx = 1; idx < parts.length; idx += 2) {
    const header = parts[idx].trim(); // e.g. "제1조(목적)" or "제1조의2(정의)"
    const content = parts[idx + 1] ? parts[idx + 1].trim() : '';
    
    // Extract article number and title
    const match = header.match(/^(제\d+조(?:의\d+)*)(?:\(([^)]+)\))?/);
    const article = match ? match[1] : header;
    const title = match && match[2] ? match[2] : '';
    
    // Skip deleted or empty articles if needed, but keeping them is safer
    if (article) {
      const numbers = article.match(/\d+/g);
      const chunkId = numbers ? `article_${numbers.join('_')}` : `article_${Buffer.from(article).toString('hex')}`;
      
      chunks.push({
        id: chunkId,
        article,
        title,
        content: `${header}\n${content}`
      });
    }
  }
  
  console.log(`Total chunks created: ${chunks.length}`);
  if (chunks.length === 0) {
    console.error('Error: No articles found. Chunking failed.');
    process.exit(1);
  }
  
  console.log('Connecting to Pinecone...');
  const pc = new Pinecone({ apiKey: pineconeKey });
  
  // Create index if it doesn't exist
  const indexes = await pc.listIndexes();
  const exists = indexes.indexes?.some(i => i.name === pineconeIndexName);
  
  if (!exists) {
    console.log(`Creating Pinecone index "${pineconeIndexName}" (1024 dimensions, cosine)...`);
    await pc.createIndex({
      name: pineconeIndexName,
      dimension: 1024,
      metric: 'cosine',
      spec: {
        serverless: {
          cloud: 'aws',
          region: 'us-east-1'
        }
      }
    });
    console.log('Waiting 15 seconds for index initialization...');
    await new Promise(resolve => setTimeout(resolve, 15000));
  }
  
  const index = pc.Index(pineconeIndexName);
  console.log(`Connected to index "${pineconeIndexName}".`);
  
  console.log('Generating embeddings and uploading to Pinecone...');
  
  // Load checkpoint
  const checkpointPath = path.join(process.cwd(), 'data', 'uploaded_chunks.json');
  let uploadedIds: string[] = [];
  if (fs.existsSync(checkpointPath)) {
    try {
      uploadedIds = JSON.parse(fs.readFileSync(checkpointPath, 'utf-8'));
      console.log(`Loaded checkpoint: ${uploadedIds.length} chunks already uploaded.`);
    } catch (e) {
      console.warn('Could not parse checkpoint file, starting fresh.');
    }
  } else {
    console.log('No checkpoint found. Clearing index to start fresh with multilingual-e5-large...');
    try {
      await index.deleteAll();
      console.log('Index cleared successfully.');
    } catch (e) {
      console.warn('Failed to clear index (might be already empty):', e);
    }
  }

  const remainingChunks = chunks.filter(c => !uploadedIds.includes(c.id));
  console.log(`Chunks remaining to upload: ${remainingChunks.length}/${chunks.length}`);

  if (remainingChunks.length === 0) {
    console.log('All chunks have already been uploaded successfully!');
    return;
  }

  // Upload in batches (Pinecone inference maxBatchSize is 96, so we use 90)
  const batchSize = 90;
  for (let idx = 0; idx < remainingChunks.length; idx += batchSize) {
    const batch = remainingChunks.slice(idx, idx + batchSize);
    console.log(`Processing batch ${Math.floor(idx / batchSize) + 1}/${Math.ceil(remainingChunks.length / batchSize)}...`);
    
    try {
      // Fetch embeddings for the whole batch at once
      const texts = batch.map(chunk => chunk.content);
      const embeddings = await getPineconeEmbeddingBatch(pc, texts);
      
      const records = batch.map((chunk, i) => ({
        id: chunk.id,
        values: embeddings[i],
        metadata: {
          article: chunk.article,
          title: chunk.title,
          content: chunk.content
        }
      }));
      
      await index.upsert({ records });
      console.log(`Uploaded batch of ${records.length} records.`);
      
      // Save checkpoint progress
      uploadedIds.push(...batch.map(c => c.id));
      fs.writeFileSync(checkpointPath, JSON.stringify(uploadedIds, null, 2), 'utf-8');
    } catch (e: any) {
      console.error(`Failed to process batch starting at index ${idx}:`, e);
      process.exit(1);
    }
    
    // Sleep 1 second between batches to avoid spamming the Pinecone Inference API too fast
    if (idx + batchSize < remainingChunks.length) {
      console.log('Sleeping 1 second to respect rate limits...');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  console.log('Data ingestion completed successfully!');
}

main().catch(err => {
  console.error('Fatal Error:', err);
  process.exit(1);
});
