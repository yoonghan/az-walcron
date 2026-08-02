import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';

const { mockItems, mockCosmosClientInstance } = vi.hoisted(() => {
    const mockItems = {
        create: vi.fn(),
        query: vi.fn()
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
    return { mockItems, mockContainer, mockDatabase, mockCosmosClientInstance };
});

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

import { DbRepo } from "./db";

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

    it('should be able to query successfully', async () => {
        const repo = new DbRepo();

        mockItems.query.mockReturnValueOnce({
            fetchAll: vi.fn().mockResolvedValueOnce({
                resources: [{
                    id: 'ai200-syllabus-chunk-1',
                    domain: 'AI-200-Syllabus',
                    content: 'Sample chunk content',
                    contentVector: [0.1, 0.2, 0.3],
                    metadata: {
                        source: 'Microsoft Learn',
                        chunkIndex: 1
                    }
                },
                {
                    id: 'ai200-syllabus-chunk-2',
                    domain: 'AI-200-Syllabus',
                    content: 'Sample chunk content 2',
                    contentVector: [0.1, 0.2, 0.3],
                    metadata: {
                        source: 'Microsoft Learn',
                        chunkIndex: 1
                    }
                },
                ]
            })
        });

        const queryVector = [0.1, 0.2, 0.3];
        const result = await repo.queryVector('AI-200-Syllabus', queryVector, 1);

        expect(mockItems.query).toHaveBeenCalledWith({
            query: `
                SELECT TOP @topN c.content, VectorDistance(c.contentVector, @queryVector) AS Score
                FROM c
                WHERE c.domain = @domain
                ORDER BY VectorDistance(c.contentVector, @queryVector)
            `,
            parameters: [
                { name: "@queryVector", value: queryVector },
                { name: "@topN", value: 1 },
                { name: "@domain", value: 'AI-200-Syllabus' }
            ]
        });
        expect(result).toBe('Sample chunk content\n\n--- NEXT CHUNK ---\n\nSample chunk content 2')
    });

});
