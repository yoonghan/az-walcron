import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock tracing as it attempts to connect to Azure Application Insights
vi.mock("./tracing", () => ({}));

import app from "./index";

vi.hoisted(() => {
	process.env.AZURE_OPENAI_ENDPOINT = "test-endpoint";
	process.env.AZURE_OPENAI_API_KEY = "test-key";
	process.env.AZURE_OPENAI_DEPLOYMENT = "test-deployment";
	process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT = "test-embedding-deployment";
	process.env.AZURE_OPENAI_API_VERSION = "test-api-version";
	process.env.AZURE_APPCONFIG_ENDPOINT = "test-connectionstring";
	process.env.COSMOSDB_ENDPOINT = "https://mock-endpoint.documents.azure.com:443/";
});

vi.mock("openai", () => {
	return {
		AzureOpenAI: class {
			models = {
				list: async () => ({
					data: [{ id: "test-model" }]
				})
			}
			chat = {
				completions: {
					create: async () => {
						return {
							choices: [{ message: { content: "{\"question\":\"You must deploy a deep-learning inference container that requires NVIDIA GPUs, must serve low-latency real-time requests at production scale, pull private images securely, and automatically scale both pods and nodes as demand changes. Which deployment architecture is the best choice?\\n\\nA) Deploy the container to Azure Container Instances (ACI) using images from Docker Hub, fronted by Azure Traffic Manager.\\n\\nB) Deploy to Azure Kubernetes Service (AKS) with a GPU-enabled node pool, store images in Azure Container Registry (ACR) with managed identity access, configure a Horizontal Pod Autoscaler and Cluster Autoscaler, and expose via an NGINX ingress controller and Azure Load Balancer.\\n\\nC) Deploy to AKS on CPU node pools, deploy multiple replicas, and use Azure App Service for Containers to balance traffic.\\n\\nD) Deploy to ACI for simplicity and use Azure Front Door for global traffic distribution.\",\"hint\":\"Choose a production-grade, GPU-capable, container-orchestrated solution that supports secure private registries and both pod and node autoscaling.\",\"answer\":\"B\",\"explanation\":\"AKS with a GPU-enabled node pool is the appropriate production-grade orchestrator for GPU inference and low-latency workloads. Storing images in ACR with managed identity lets AKS pull images securely. Horizontal Pod Autoscaler handles pod-level scaling, Cluster Autoscaler adjusts node count for GPU capacity, and an ingress controller + Azure Load Balancer provides stable, low-latency external access. ACI is simpler but not ideal for production-scale GPU orchestration and fine-grained autoscaling.\"}" } }]
						};
					}
				}
			}
			embeddings = {
				create: vi.fn().mockResolvedValue({
					data: [{
						embedding: []
					}]
				})
			}
		}
	}
});

vi.mock("@azure/app-configuration", () => {
	return {
		AppConfigurationClient: class {
			constructor() {
			}
			getConfigurationSetting = vi.fn().mockImplementation(async ({ key }: { key: string }) => {
				return { key, value: "test" }
			});
		}
	}
});

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


describe("API Routes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("GET /healthz", () => {
		it("should return ready", async () => {
			const res = await app.request("/healthz");
			expect(res.status).toBe(200);
			expect(await res.text()).toBe("ready");
		});
	});

	describe("GET /", () => {
		it("should return html", async () => {
			const res = await app.request("/");
			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toContain("text/html");
		});
	});

	describe("GET /openai", () => {
		it("should return openai api spec", async () => {
			const res = await app.request("/openai");
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ openai: "3.1.0", info: { title: "Walcron AI API", version: "1.0.0" }, deployment: "test-deployment", models: [{ id: "test-model" }] });
		});

		it("should return config api spec", async () => {
			const res = await app.request("/openai/config");
			expect(res.status).toBe(200);
			const json = await res.json()
			expect(json.config.systemPrompt).toEqual("test");
		});
	});

	describe("GET /openai/question", () => {
		beforeEach(() => {
			mockItems.query.mockReturnValueOnce({
				fetchAll: vi.fn().mockResolvedValueOnce({
					resources: []
				})
			});
			mockItem.read.mockRejectedValueOnce({
				code: 404
			})
			mockItems.upsert.mockReturnValueOnce({
				resource: {},
				requestCharge: '200'
			})
		});

		it("should return error if no question are asked", async () => {
			const res = await app.request("/openai/question", {
				method: "GET"
			});
			expect(res.status).toBe(400);
			const json = await res.json();
			expect(json).toEqual({ error: "question is required" });
		});

		it("should return question completion", async () => {
			const res = await app.request("/openai/question?q=what is azure machine learning?", {
				method: "GET"
			});
			expect(res.status).toBe(200);
			const json = await res.json();
			expect(json).toEqual({ choices: [{ message: { content: "{\"question\":\"You must deploy a deep-learning inference container that requires NVIDIA GPUs, must serve low-latency real-time requests at production scale, pull private images securely, and automatically scale both pods and nodes as demand changes. Which deployment architecture is the best choice?\\n\\nA) Deploy the container to Azure Container Instances (ACI) using images from Docker Hub, fronted by Azure Traffic Manager.\\n\\nB) Deploy to Azure Kubernetes Service (AKS) with a GPU-enabled node pool, store images in Azure Container Registry (ACR) with managed identity access, configure a Horizontal Pod Autoscaler and Cluster Autoscaler, and expose via an NGINX ingress controller and Azure Load Balancer.\\n\\nC) Deploy to AKS on CPU node pools, deploy multiple replicas, and use Azure App Service for Containers to balance traffic.\\n\\nD) Deploy to ACI for simplicity and use Azure Front Door for global traffic distribution.\",\"hint\":\"Choose a production-grade, GPU-capable, container-orchestrated solution that supports secure private registries and both pod and node autoscaling.\",\"answer\":\"B\",\"explanation\":\"AKS with a GPU-enabled node pool is the appropriate production-grade orchestrator for GPU inference and low-latency workloads. Storing images in ACR with managed identity lets AKS pull images securely. Horizontal Pod Autoscaler handles pod-level scaling, Cluster Autoscaler adjusts node count for GPU capacity, and an ingress controller + Azure Load Balancer provides stable, low-latency external access. ACI is simpler but not ideal for production-scale GPU orchestration and fine-grained autoscaling.\"}" } }] });
		});

		it("should return question completion prettier", async () => {
			const res = await app.request("/openai/question?q=what is azure machine learning?&pretty=1", {
				method: "GET"
			});
			expect(res.status).toBe(200);
			const json = await res.json();
			expect(json.result).toBe("B");
		});
	});
});
