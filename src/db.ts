import { CosmosClient, Database, Container } from "@azure/cosmos"
import { DefaultAzureCredential } from "@azure/identity";

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
}
