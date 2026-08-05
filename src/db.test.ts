import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';

const { mockItems, mockItem, mockCosmosClientInstance } = vi.hoisted(() => {
    process.env.COSMOSDB_ENDPOINT = 'https://mock-endpoint.documents.azure.com:443/';

    const mockItems = {
        create: vi.fn(),
        query: vi.fn(),
        upsert: vi.fn()
    };

    const mockItem = {
        read: vi.fn()
    }

    const mockContainer = {
        items: mockItems,
        item: vi.fn().mockReturnValue(mockItem)
    };
    const mockDatabase = {
        container: vi.fn().mockReturnValue(mockContainer)
    };
    const mockCosmosClientInstance = {
        database: vi.fn().mockReturnValue(mockDatabase)
    };
    return { mockItems, mockItem, mockContainer, mockDatabase, mockCosmosClientInstance };
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
    let repo: DbRepo;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env = { ...originalEnv };
        process.env.COSMOSDB_ENDPOINT = 'https://mock-endpoint.documents.azure.com:443/';
        repo = new DbRepo();
    });

    it('should initialize successfully with valid configuration', () => {
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

    it('should be able to upsert user progress successfully', async () => {
        mockItems.upsert.mockReturnValueOnce({
            resource: {},
            requestCharge: '200'
        })

        const date = new Date().toISOString()
        const result = await repo.saveProgressToCosmos('AI-200-Syllabus', 'Fundamentals', 100, date);

        expect(mockItems.upsert).toHaveBeenCalledWith({
            id: `progress-dev-user-001-ai-200-syllabus-fundamentals`,
            userId: "dev-user-001",
            topic: 'AI-200-Syllabus',
            subTopic: 'Fundamentals',
            type: 'progress',
            latestScore: 100,
            lastTestedAt: date
        });
        expect(result).toBe('Success: Saved score 100 for topic AI-200-Syllabus and subtopic Fundamentals.')
    });

    it('should be able to capture user progress error', async () => {
        mockItems.upsert.mockRejectedValueOnce(new Error("Failed to save progress"))

        const date = new Date().toISOString()
        const result = await repo.saveProgressToCosmos('AI-200-Syllabus', 'Fundamentals', 100, date);

        expect(result).toBe("Error: Could not save progress to the database.")
    });

    it('should be to check for user weak topics', async () => {
        mockItems.query.mockReturnValueOnce({
            fetchAll: vi.fn().mockResolvedValueOnce({
                resources: [{
                    id: `progress-dev-user-001-keda`,
                    userId: "dev-user-001",
                    topic: 'KEDA',
                    type: 'progress',
                    latestScore: 50,
                    lastTestedAt: new Date().toISOString()
                },
                {
                    id: `progress-dev-user-001-azure-container`,
                    userId: "dev-user-001",
                    topic: 'Azure Container',
                    type: 'progress',
                    latestScore: 50,
                    lastTestedAt: new Date().toISOString()
                }
                ]
            })
        });

        const result = await repo.searchUserWeakTopic(79);

        expect(result).toEqual('KEDA, Azure Container')
    });

    it('should be able to update user chat messages', async () => {
        const messages = [
            {
                content: "Tell me about AI-200-Syllabus",
                role: "user",
            },
            {
                content: "AI-200-Syllabus is a course about AI.",
                role: "assistant",
            },
        ]

        mockItems.upsert.mockReturnValueOnce({
            resource: {
                messages
            },
            requestCharge: '200'
        })

        const result = await repo.saveChatTurn(messages);

        expect(mockItems.upsert).toHaveBeenCalledWith({
            id: `session-default-001`,
            userId: "dev-user-001",
            messages,
            type: "chat",
        });
        expect(result).toEqual(messages)
    });

    it('should be able to throw error if user chat error on retrieval', async () => {
        mockItems.upsert.mockRejectedValueOnce(new Error("Failed to save progress"))

        const result = await repo.saveChatTurn([])

        expect(result).toEqual("Save chat failed.")
    });

    it('should be able to get user chat messages', async () => {
        const messageResult = {
            messages: [
                {
                    content: "Tell me about AI-200-Syllabus",
                    role: "user",
                },
                {
                    content: "AI-200-Syllabus is a course about AI.",
                    role: "assistant",
                },
            ]
        }

        mockItem.read.mockReturnValueOnce({
            resource: {
                id: "session-default-001",
                userId: "dev-user-001",
                type: "chat",
                messages: [...messageResult.messages]
            }
        })

        const result = await repo.getSavedChat("Exam tutor");

        expect(result).toEqual({
            id: "session-default-001",
            messages: [
                ...messageResult.messages
            ],
            type: "chat",
            userId: "dev-user-001",
        });
    });

    it('should be create new message if not found', async () => {
        mockItem.read.mockReturnValueOnce({
            statusCode: 404
        })


        const result = await repo.getSavedChat("Exam tutor");
        expect(result).toEqual({
            id: "session-default-001",
            messages: [
                {
                    content: "Exam tutor",
                    role: "system"
                }
            ],
            type: "chat",
            userId: "dev-user-001",
        });
    });

    it('should be able to throw error if user chat error on retrieval', async () => {
        mockItem.read.mockRejectedValueOnce(new Error("Failed to save progress"))

        await expect(repo.getSavedChat("Exam tutor", "I do not know.")).rejects.toThrow("Failed to save progress")
    });
});
