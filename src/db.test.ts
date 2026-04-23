import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@azure/identity", () => ({
	DefaultAzureCredential: vi.fn(),
}));

const mockItemReplace = vi.fn();
const mockItemDelete = vi.fn();
const mockItemRead = vi.fn();
const mockItem = vi.fn().mockImplementation(() => ({
	read: mockItemRead,
	replace: mockItemReplace,
	delete: mockItemDelete,
}));

const mockItemsCreate = vi.fn();
const mockItemsQueryFetchAll = vi.fn();
const mockQuery = vi.fn().mockImplementation(() => ({
	fetchAll: mockItemsQueryFetchAll,
}));

vi.mock("@azure/cosmos", () => {
	return {
		CosmosClient: class {
			database() {
				return {
					container() {
						return {
							items: {
								query: mockQuery,
								create: mockItemsCreate,
							},
							item: mockItem,
						};
					},
				};
			}
		},
	};
});

// Import after mocks are initialized
import { CosmosRepo } from "./db";

describe("CosmosRepo", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.env.COSMOS_ENDPOINT = "https://fake.cosmos.azure.com";
		process.env.COSMOS_DATABASE = "db1";
		process.env.COSMOS_CONTAINER = "c1";
	});

	describe("Initialization", () => {
		it("should throw if COSMOS_ENDPOINT is missing", () => {
			delete process.env.COSMOS_ENDPOINT;
			expect(() => new CosmosRepo()).toThrowError(
				"COSMOS_ENDPOINT must be set",
			);
		});

		it("should initialize successfully", () => {
			const repo = new CosmosRepo();
			expect(repo).toBeDefined();
		});
	});

	describe("listObjectives", () => {
		it("should throw if DB/Container env vars are missing", async () => {
			delete process.env.COSMOS_DATABASE;
			const repo = new CosmosRepo();
			await expect(repo.listObjectives()).rejects.toThrowError(
				"COSMOS_DATABASE and COSMOS_CONTAINER must be set",
			);
		});

		it("should return objectives", async () => {
			mockItemsQueryFetchAll.mockResolvedValueOnce({
				resources: ["Work", "Personal"],
			});
			const repo = new CosmosRepo();
			const res = await repo.listObjectives();
			expect(res).toEqual(["Work", "Personal"]);
			expect(mockQuery).toHaveBeenCalledWith({
				query: "SELECT DISTINCT VALUE c.objective FROM c",
			});
		});
	});

	describe("listTodos", () => {
		it("should return todos", async () => {
			const mockTodos = [
				{ id: "1", title: "Test", objective: "Work", completed: false },
			];
			mockItemsQueryFetchAll.mockResolvedValueOnce({ resources: mockTodos });
			const repo = new CosmosRepo();
			const res = await repo.listTodos();
			expect(res).toEqual(mockTodos);
			expect(mockQuery).toHaveBeenCalledWith({ query: "SELECT * FROM c" });
		});
	});

	describe("createTodo", () => {
		it("should create and return todo", async () => {
			const newTodo = {
				id: "1",
				title: "Test",
				objective: "Work",
				completed: false,
			};
			mockItemsCreate.mockResolvedValueOnce({ resource: newTodo });

			const repo = new CosmosRepo();
			const res = await repo.createTodo(newTodo);
			expect(res).toEqual(newTodo);
			expect(mockItemsCreate).toHaveBeenCalledWith(newTodo);
		});

		it("should throw if resource creation fails", async () => {
			mockItemsCreate.mockResolvedValueOnce({ resource: null });
			const repo = new CosmosRepo();
			await expect(
				repo.createTodo({
					id: "1",
					title: "T",
					objective: "O",
					completed: false,
				}),
			).rejects.toThrowError("Failed to create todo resource");
		});
	});

	describe("updateTodo", () => {
		it("should update and return todo", async () => {
			const oldTodo = {
				id: "1",
				title: "Old",
				objective: "Work",
				completed: false,
			};
			const newTodo = {
				id: "1",
				title: "New",
				objective: "Work",
				completed: true,
			};

			mockItemRead.mockResolvedValueOnce({ resource: oldTodo });
			mockItemReplace.mockResolvedValueOnce({ resource: newTodo });

			const repo = new CosmosRepo();
			const res = await repo.updateTodo("1", "Work", "New", true);

			expect(res).toEqual(newTodo);
			expect(mockItem).toHaveBeenCalledWith("1", "Work");
			expect(mockItemReplace).toHaveBeenCalledWith({
				...oldTodo,
				title: "New",
				completed: true,
			});
		});

		it("should return null if todo not found via read", async () => {
			mockItemRead.mockResolvedValueOnce({ resource: null });
			const repo = new CosmosRepo();
			const res = await repo.updateTodo("1", "Work", "New", true);
			expect(res).toBeNull();
		});

		it("should return null if item read throws 404", async () => {
			const error = new Error("Not found") as Error & { code?: number };
			error.code = 404;
			mockItemRead.mockRejectedValueOnce(error);
			const repo = new CosmosRepo();
			const res = await repo.updateTodo("1", "Work", "New", true);
			expect(res).toBeNull();
		});

		it("should rethrow if item read throws other error", async () => {
			const error = new Error("DB Error");
			mockItemRead.mockRejectedValueOnce(error);
			const repo = new CosmosRepo();
			await expect(
				repo.updateTodo("1", "Work", "New", true),
			).rejects.toThrowError("DB Error");
		});
	});

	describe("deleteTodo", () => {
		it("should delete and return true", async () => {
			mockItemDelete.mockResolvedValueOnce({ resource: true });
			const repo = new CosmosRepo();
			const res = await repo.deleteTodo("1", "Work");
			expect(res).toBe(true);
			expect(mockItem).toHaveBeenCalledWith("1", "Work");
			expect(mockItemDelete).toHaveBeenCalled();
		});

		it("should return false if item delete throws 404", async () => {
			const error = new Error("Not found") as Error & { code?: number };
			error.code = 404;
			mockItemDelete.mockRejectedValueOnce(error);
			const repo = new CosmosRepo();
			const res = await repo.deleteTodo("1", "Work");
			expect(res).toBe(false);
		});

		it("should rethrow if item delete throws other error", async () => {
			const error = new Error("DB Error");
			mockItemDelete.mockRejectedValueOnce(error);
			const repo = new CosmosRepo();
			await expect(repo.deleteTodo("1", "Work")).rejects.toThrowError(
				"DB Error",
			);
		});
	});
});
