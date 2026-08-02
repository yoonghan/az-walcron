import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DbRepo } from './db';
import { CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';

const mockItems = {
    create: vi.fn()
};
const mockContainer = {
    items: mockItems
};
const mockDatabase = {
    container: vi.fn().mockReturnValue(mockContainer)
};
const mockCosmosClientInstance = {
    database: vi.fn().mockReturnValue(mockDatabase)
};

vi.mock('@azure/cosmos', () => {
    return {
        CosmosClient: vi.fn().mockImplementation(function () { return mockCosmosClientInstance; })
    };
});

vi.mock('@azure/identity', () => {
    return {
        DefaultAzureCredential: vi.fn().mockImplementation(function () { return {}; })
    };
});

describe('DbRepo', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env = { ...originalEnv };
        process.env.COSMOSDB_ENDPOINT = 'https://mock-endpoint.documents.azure.com:443/';
    });

    it('should initialize successfully with valid configuration', () => {
        const repo = new DbRepo();

        expect(DefaultAzureCredential).toHaveBeenCalled();
        expect(CosmosClient).toHaveBeenCalledWith({
            endpoint: 'https://mock-endpoint.documents.azure.com:443/',
            aadCredentials: expect.any(Object)
        });

        const cosmosClientInstance = vi.mocked(CosmosClient).mock.results[0].value;
        expect(cosmosClientInstance.database).toHaveBeenCalledWith('StudyBuddy');

        const databaseInstance = cosmosClientInstance.database.mock.results[0].value;
        expect(databaseInstance.container).toHaveBeenCalledWith('SyllabusKnowledge');

        expect(repo).toBeDefined();
    });

    it('should throw an error if COSMOSDB_ENDPOINT is not set', () => {
        delete process.env.COSMOSDB_ENDPOINT;

        expect(() => new DbRepo()).toThrow('Missing CosmosDB configuration');
    });

    it('should create an item successfully', async () => {
        const repo = new DbRepo();
        const sampleItem = {
            id: 'ai200-syllabus-chunk-1',
            domain: 'AI-200-Syllabus',
            content: 'Sample chunk content',
            contentVector: [0.1, 0.2, 0.3],
            metadata: {
                source: 'Microsoft Learn',
                chunkIndex: 1
            }
        };

        mockItems.create.mockResolvedValueOnce({ resource: sampleItem });

        await repo.createItem(sampleItem);

        expect(mockItems.create).toHaveBeenCalledWith(sampleItem);
    });

});
