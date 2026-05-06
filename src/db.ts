import { DaprClient } from "@dapr/dapr";

export interface Todo {
	id: string;
	objective: string;
	title: string;
	completed: boolean;
}

export class DaprRepo {
	private client: DaprClient;
	private stateStoreName = "todostore";

	constructor() {
		const daprHost = process.env.DAPR_HOST || "127.0.0.1";
		const daprPort =
			process.env.DAPR_HTTP_PORT || process.env.DAPR_GRPC_PORT || "3500";

		this.client = new DaprClient({ daprHost, daprPort });
	}

	private parseQueryItem(r: any): Todo {
		console.log("Parsing item:", JSON.stringify(r));
		// If r.data is null or undefined, try r.value, then fallback to r itself
		let content = r.data;
		if (content === undefined || content === null) {
			content = r.value !== undefined ? r.value : r;
		}

		if (content instanceof Uint8Array || Buffer.isBuffer(content)) {
			try {
				content = JSON.parse(Buffer.from(content).toString());
			} catch (e) {
				// ignore
			}
		} else if (typeof content === "string") {
			try {
				content = JSON.parse(content);
			} catch (e) {
				// ignore
			}
		}

		// Handle CosmosDB wrapping if it exists (Dapr saves as { "id": "...", "value": { ... } })
		if (content && typeof content === "object" && "value" in content) {
			content = content.value;
		}

		return content as Todo;
	}

	async listObjectives(): Promise<string[]> {
		const response = await this.client.state.query(this.stateStoreName, {
			filter: {},
			sort: [],
			page: {
				limit: 100,
				token: undefined
			}
		});
		const todos = response.results.map((r: any) => this.parseQueryItem(r));
		const objectives = new Set(todos.map((t) => t.objective));
		return Array.from(objectives);
	}

	async listTodos(): Promise<Todo[]> {
		const response = await this.client.state.query(this.stateStoreName, {
			filter: {},
			sort: [],
			page: {
				limit: 100,
				token: undefined
			}
		});
		return response.results.map((r: any) => this.parseQueryItem(r));
	}

	async createTodo(todo: Todo): Promise<Todo> {
		await this.client.state.save(this.stateStoreName, [
			{
				key: todo.id,
				value: todo,
				metadata: { partitionKey: todo.objective },
			},
		]);
		return todo;
	}

	async updateTodo(
		id: string,
		objective: string,
		title: string,
		completed: boolean,
	): Promise<Todo | null> {
		const existing = await this.client.state.get(this.stateStoreName, id, {
			metadata: { partitionKey: objective },
		});
		if (!existing || Object.keys(existing).length === 0) return null;

		const updatedTodo = {
			...(existing as Todo),
			title,
			completed,
		};

		await this.client.state.save(this.stateStoreName, [
			{
				key: id,
				value: updatedTodo,
				metadata: { partitionKey: objective },
			},
		]);
		return updatedTodo;
	}

	async deleteTodo(id: string, objective: string): Promise<boolean> {
		const existing = await this.client.state.get(this.stateStoreName, id, {
			metadata: { partitionKey: objective },
		});
		if (!existing || Object.keys(existing).length === 0) return false;

		await this.client.state.delete(this.stateStoreName, id, {
			metadata: { partitionKey: objective },
		});
		return true;
	}
}

export const dbRepo = new DaprRepo();
