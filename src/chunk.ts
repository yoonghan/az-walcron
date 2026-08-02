import fs from 'fs'
import { PDFParse } from 'pdf-parse'
import { DbRepo } from './db'
import { OpenAiSpec } from './openai';

/* Things to set
    export AZURE_OPENAI_ENDPOINT;
    export AZURE_OPENAI_API_KEY;
    export AZURE_OPENAI_DEPLOYMENT=text-embedding-3-small
    export AZURE_OPENAI_API_VERSION=2024-02-15-preview
    export COSMOSDB_ENDPOINT;
    * Click on Download on left from: https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/ai-200
    * login to Azure (az login)
    * Assign role
    MY_PRINCIPAL_ID=$(az ad signed-in-user show --query id -o tsv)
    az cosmosdb sql role assignment create \
    --account-name walcron-cosmosdb \
    --resource-group walcron-rg \
    --role-definition-id "00000000-0000-0000-0000-000000000002" \
    --principal-id $MY_PRINCIPAL_ID \
    --scope "/"
*/

// The Chunking Algorithm
function chunkTextWithOverlap(text: string, chunkSize = 1000, overlap = 200) {
    const chunks = [];
    let i = 0;

    // Clean up the PDF text (remove weird newlines/spaces)
    const cleanText = text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();

    while (i < cleanText.length) {
        chunks.push(cleanText.slice(i, i + chunkSize));
        i += chunkSize - overlap;
    }
    return chunks;
}

async function processSyllabusAndStore(domain: string, source: string) {
    const dbRepo = new DbRepo();
    console.log("1. Reading and parsing AI-200 Syllabus PDF...");
    const dataBuffer = fs.readFileSync('/Users/hayo/Downloads/AI-200-Study-Guide.pdf');
    console.log("1.1 Converting Buffer to Uint8Array...");
    const dataUint8Array = new Uint8Array(dataBuffer);
    console.log("1.2 Creating PDFParse instance...");
    const pdfData = new PDFParse(dataUint8Array)
    console.log("1.3 Extracting text...");
    const result = await pdfData.getText();
    console.log("1.3 Extracting text... OK");
    const text = result?.text || ''
    const openai = new OpenAiSpec()

    console.log("2. Chunking text...");
    // 1000 chars is roughly 200-250 words. Overlap ensures sentences aren't lost.
    const chunks = chunkTextWithOverlap(text, 1000, 200);
    console.log(`Created ${chunks.length} chunks from the PDF.`);

    console.log("3. Embedding and Saving to Cosmos DB...");

    for (let i = 0; i < chunks.length; i++) {
        const chunkContent = chunks[i];

        // Generate Vector
        const embeddingResponse = await openai.createEmbeddings(chunkContent, 1536)
        const vectorArray = embeddingResponse.data[0].embedding;

        // Save to Cosmos DB
        const document = {
            id: `ai200-syllabus-chunk-${i}`,
            domain: domain, // Partition Key
            content: chunkContent,
            contentVector: vectorArray,
            metadata: {
                source: source,
                chunkIndex: i
            }
        };

        dbRepo.createItem(document);

        console.log(`Saved Chunk ${i + 1}/${chunks.length} to Cosmos DB`);
    }

    console.log("Knowledge Base fully populated and indexed!");
}

processSyllabusAndStore("AI-200-Syllabus", "Microsoft Learn").catch(console.error);