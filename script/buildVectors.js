require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');

const HF_TOKEN = process.env.HF_TOKEN;
const HF_URL = 'https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/feature-extraction';
const KB_FOLDER = path.join(__dirname, '..', 'knowledge');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'boma-vectors.json');

// Split text into ~300 word chunks
function chunkText(text, source) {
  const words = text.split(/\s+/);
  const chunks = [];
  for (let i = 0; i < words.length; i += 250) {
    const chunk = words.slice(i, i + 300).join(' ').trim();
    if (chunk.length > 100) {
      chunks.push({ text: chunk, source });
    }
  }
  return chunks;
}

// Read all .md files recursively
function getAllMarkdownFiles(dir) {
  let files = [];
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      files = files.concat(getAllMarkdownFiles(fullPath));
    } else if (item.endsWith('.md')) {
      files.push(fullPath);
    }
  }
  return files;
}

// Call HuggingFace API to embed text
async function embedTexts(texts) {
  const response = await fetch(HF_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${HF_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ inputs: texts }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`HuggingFace API error: ${err}`);
  }

  return await response.json();
}

// Wait helper to avoid rate limits
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function build() {
  console.log('Reading knowledge folder...');
  const files = getAllMarkdownFiles(KB_FOLDER);
  console.log(`Found ${files.length} markdown files`);

  let allChunks = [];

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const relativePath = path.relative(KB_FOLDER, file);
    const chunks = chunkText(text, relativePath);
    allChunks = allChunks.concat(chunks);
  }

  console.log(`Total chunks to embed: ${allChunks.length}`);

  const results = [];
  const batchSize = 5;

  for (let i = 0; i < allChunks.length; i += batchSize) {
    const batch = allChunks.slice(i, i + batchSize);
    const texts = batch.map(c => c.text);

    process.stdout.write(`Embedding chunks ${i + 1}–${Math.min(i + batchSize, allChunks.length)} of ${allChunks.length}...\r`);

    try {
      const embeddings = await embedTexts(texts);
      for (let j = 0; j < batch.length; j++) {
        results.push({
          text: batch[j].text,
          source: batch[j].source,
          embedding: embeddings[j],
        });
      }
    } catch (err) {
      console.error(`\nFailed on batch ${i}:`, err.message);
    }

    await wait(500);
  }

  if (!fs.existsSync(path.dirname(OUTPUT_FILE))) {
    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  console.log(`\nDone. ${results.length} vectors saved to data/boma-vectors.json`);
}

build();



