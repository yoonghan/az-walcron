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

	async listObjectives(): Promise<string[]> {
		const response = await this.client.state.query(this.stateStoreName, {
			filter: {},
		});
		const todos = response.results.map((r: { data: Todo }) => r.data as Todo);
		const objectives = new Set(todos.map((t) => t.objective));
		return Array.from(objectives);
	}

	async listTodos(): Promise<Todo[]> {
		const response = await this.client.state.query(this.stateStoreName, {
			filter: {},
		});
		return response.results.map((r: { data: Todo }) => r.data as Todo);
	}

	async createTodo(todo: Todo): Promise<Todo> {
		await this.client.state.save(this.stateStoreName, [
			{ key: todo.id, value: todo },
		]);
		return todo;
	}

	async updateTodo(
		id: string,
		objective: string,
		title: string,
		completed: boolean,
	): Promise<Todo | null> {
		const existing = await this.client.state.get(this.stateStoreName, id);
		if (!existing || Object.keys(existing).length === 0) return null;

		const updatedTodo = {
			...(existing as Todo),
			title,
			completed,
		};

		await this.client.state.save(this.stateStoreName, [
			{ key: id, value: updatedTodo },
		]);
		return updatedTodo;
	}

	async deleteTodo(id: string, objective: string): Promise<boolean> {
		const existing = await this.client.state.get(this.stateStoreName, id);
		if (!existing || Object.keys(existing).length === 0) return false;

		await this.client.state.delete(this.stateStoreName, id);
		return true;
	}
}

export const dbRepo = new DaprRepo();
