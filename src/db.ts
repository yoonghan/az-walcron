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
}

export const dbRepo = new DbRepo()