import { CosmosClient } from "@azure/cosmos";
import { DefaultAzureCredential } from "@azure/identity";

export interface Todo {
	id: string; // The @azure/cosmos SDK uses 'id' string explicitly
	objective: string;
	title: string;
	completed: boolean;
}

export class CosmosRepo {
	private client: CosmosClient;

	constructor() {
		const endpoint = process.env.COSMOS_ENDPOINT;
		if (!endpoint) throw new Error("COSMOS_ENDPOINT must be set");

		// Use Managed Identity locally and in ACA
		const credential = new DefaultAzureCredential();
		this.client = new CosmosClient({ endpoint, aadCredentials: credential });
	}

	private getContainer() {
		const databaseName = process.env.COSMOS_DATABASE;
		const containerName = process.env.COSMOS_CONTAINER;
		if (!databaseName || !containerName)
			throw new Error("COSMOS_DATABASE and COSMOS_CONTAINER must be set");

		return this.client.database(databaseName).container(containerName);
	}

	async listObjectives(): Promise<string[]> {
		const container = this.getContainer();
		const querySpec = {
			query: "SELECT DISTINCT VALUE c.objective FROM c",
		};

		const { resources: objectives } = await container.items
			.query(querySpec)
			.fetchAll();
		return objectives as string[];
	}

	async listTodos(): Promise<Todo[]> {
		const container = this.getContainer();
		const querySpec = {
			query: "SELECT * FROM c",
		};

		const { resources: todos } = await container.items
			.query(querySpec)
			.fetchAll();
		return todos as Todo[];
	}

	async createTodo(todo: Todo): Promise<Todo> {
		const container = this.getContainer();
		const { resource } = await container.items.create(todo);
		if (!resource) throw new Error("Failed to create todo resource");
		return resource as unknown as Todo;
	}

	async updateTodo(
		id: string,
		objective: string,
		title: string,
		completed: boolean,
	): Promise<Todo | null> {
		const container = this.getContainer();
		const item = container.item(id, objective);

		try {
			const { resource } = await item.read<Todo>();
			if (!resource) return null;

			const updatedItem = {
				...resource,
				title,
				completed,
			};

			const { resource: updatedResource } = await item.replace(updatedItem);
			return updatedResource || null;
		} catch (e: unknown) {
			if (
				e &&
				typeof e === "object" &&
				"code" in e &&
				(e as { code?: number }).code === 404
			)
				return null;
			throw e;
		}
	}

	async deleteTodo(id: string, objective: string): Promise<boolean> {
		const container = this.getContainer();
		const item = container.item(id, objective);

		try {
			await item.delete();
			return true;
		} catch (e: unknown) {
			if (
				e &&
				typeof e === "object" &&
				"code" in e &&
				(e as { code?: number }).code === 404
			)
				return false;
			throw e;
		}
	}
}

export const dbRepo = new CosmosRepo();
