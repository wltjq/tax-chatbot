import { Pinecone } from '@pinecone-database/pinecone';

const pineconeApiKey = process.env.PINECONE_API_KEY || '';
const pineconeIndexName = process.env.PINECONE_INDEX || 'tax-chatbot';
const geminiApiKey = process.env.GEMINI_API_KEY || '';

// Initialize Pinecone Client
let pinecone: Pinecone | null = null;
try {
  if (pineconeApiKey && !pineconeApiKey.startsWith('your_')) {
    pinecone = new Pinecone({ apiKey: pineconeApiKey });
  }
} catch (e) {
  console.error('Failed to initialize Pinecone Client:', e);
}

// Pinecone Inference Embedding Helper (multilingual-e5-large)
export async function getEmbedding(text: string): Promise<number[]> {
  if (!pinecone) {
    throw new Error('Pinecone client is not initialized. Please set PINECONE_API_KEY in .env.local');
  }

  const result = await pinecone.inference.embed({
    model: 'multilingual-e5-large',
    inputs: [text],
    parameters: { inputType: 'query' }
  });

  const embedding = result.data?.[0] as any;
  if (!embedding || !embedding.values) {
    throw new Error('Failed to generate embedding from Pinecone Inference API.');
  }

  return embedding.values;
}

export interface TaxLawMatch {
  id: string;
  article: string;
  title: string;
  content: string;
  score: number;
}

/**
 * Searches the Pinecone vector index for relevant tax law articles.
 */
export async function searchTaxLaw(query: string, limit = 4): Promise<TaxLawMatch[]> {
  if (!pinecone) {
    console.warn('Pinecone is not initialized. Returning empty search results.');
    return [];
  }

  try {
    const queryVector = await getEmbedding(query);
    const index = pinecone.Index(pineconeIndexName);
    
    const searchResponse = await index.query({
      vector: queryVector,
      topK: limit,
      includeMetadata: true
    });

    const matches: TaxLawMatch[] = [];
    if (searchResponse.matches) {
      for (const m of searchResponse.matches) {
        if (m.metadata) {
          matches.push({
            id: m.id,
            article: (m.metadata.article as string) || '',
            title: (m.metadata.title as string) || '',
            content: (m.metadata.content as string) || '',
            score: m.score || 0
          });
        }
      }
    }
    
    return matches;
  } catch (error) {
    console.error('Error searching Pinecone:', error);
    return [];
  }
}
