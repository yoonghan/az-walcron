import { CosmosClient, Database, Container } from "@azure/cosmos"
import { DefaultAzureCredential } from "@azure/identity";

export interface Item {
    id: string,
    domain: string,
    content: string,
    contentVector: number[],
    metadata: {
        source: string,
        chunkIndex: number
    }
}

export class DbRepo {
    private cosmosClient: CosmosClient;
    private database: Database;
    private container: Container;
    private userDataContainer: Container;

    constructor() {

        const endpoint = process.env.COSMOSDB_ENDPOINT;
        const aadCredentials = new DefaultAzureCredential();

        if (!endpoint) {
            throw new Error("Missing CosmosDB configuration");
        }

        this.cosmosClient = new CosmosClient({
            endpoint,
            aadCredentials
        })

        this.database = this.cosmosClient.database("StudyBuddy");
        this.container = this.database.container("SyllabusKnowledge");
        this.userDataContainer = this.database.container("UserData");
    }

    async createItem(item: Item) {
        return await this.container.items.create(item);
    }

    async queryVector(domain: string, queryVector: number[], topN = 5) {
        const querySpec = {
            query: `
                SELECT TOP @topN c.content, VectorDistance(c.contentVector, @queryVector) AS Score
                FROM c
                WHERE c.domain = @domain
                ORDER BY VectorDistance(c.contentVector, @queryVector)
            `,
            parameters: [
                { name: "@queryVector", value: queryVector },
                { name: "@topN", value: topN },
                { name: "@domain", value: domain }
            ]
        };

        const { resources: results } = await this.container.items.query(querySpec).fetchAll();
        const retrievedContext = results.map(r => r.content).join("\n\n--- NEXT CHUNK ---\n\n");

        console.log("retrievedContext", retrievedContext)
        return retrievedContext;
    }

    async saveProgressToCosmos(topic: string, score: number, date: string) {
        try {

            // Hardcoding a userId for the sandbox, but this would come from Entra ID later
            const userId = "dev-user-001";
            const docId = `progress-${userId}-${topic.toLowerCase().replace(/\s+/g, '-')}`;

            const progressDocument = {
                id: docId,
                userId: userId,           // Partition Key
                topic: topic,
                latestScore: score,
                lastTestedAt: date
            };

            // Upsert will create it if it doesn't exist, or update the score if it does
            const { resource } = await this.userDataContainer.items.upsert(progressDocument);

            console.log(`[DB] Successfully saved score of ${score} for ${topic}. RU Cost: ${resource?._requestCharge}`);

            // This string is what gets sent back to the LLM in the "tool" message role
            return `Success: Saved score ${score} for topic ${topic}.`;

        } catch (error) {
            console.error("Cosmos DB Error:", error);
            return "Error: Could not save progress to the database.";
        }
    }

    async searchUserWeakTopic(scoreThreshold: number) {
        const userId = "dev-user-001";

        // Upsert will create it if it doesn't exist, or update the score if it does
        const { resources: results } = await this.userDataContainer.items.query({
            query: `SELECT * FROM c WHERE c.userId = @userId AND c.latestScore < @scoreThreshold`,
            parameters: [
                { name: "@userId", value: userId },
                { name: "@scoreThreshold", value: scoreThreshold }
            ]
        }).fetchAll();

        // This string is what gets sent back to the LLM in the "tool" message role
        return results.map((r) => r.topic).join(", ");
    }
}

export const dbRepo = new DbRepo()