import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockStateSave, mockStateGet, mockStateDelete, mockStateQuery } =
	vi.hoisted(() => {
		return {
			mockStateSave: vi.fn(),
			mockStateGet: vi.fn(),
			mockStateDelete: vi.fn(),
			mockStateQuery: vi.fn(),
		};
	});

vi.mock("@dapr/dapr", () => {
	return {
		DaprClient: class {
			state = {
				save: mockStateSave,
				get: mockStateGet,
				delete: mockStateDelete,
				query: mockStateQuery,
			};
		},
	};
});

// Import after mocks are initialized
import { DaprRepo } from "./db";

describe("DaprRepo", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("Initialization", () => {
		it("should initialize successfully", () => {
			const repo = new DaprRepo();
			expect(repo).toBeDefined();
		});
	});

	describe("listObjectives", () => {
		it("should return objectives", async () => {
			mockStateQuery.mockResolvedValueOnce({
				results: [
					{
						data: {
							id: "1",
							title: "Test 1",
							objective: "Work",
							completed: false,
						},
					},
					{
						data: {
							id: "2",
							title: "Test 2",
							objective: "Personal",
							completed: false,
						},
					},
					{
						data: {
							id: "3",
							title: "Test 3",
							objective: "Work",
							completed: false,
						},
					},
				],
			});
			const repo = new DaprRepo();
			const res = await repo.listObjectives();
			expect(res).toEqual(["Work", "Personal"]);
			expect(mockStateQuery).toHaveBeenCalledWith("todostore", {
				filter: {},
				sort: [],
				page: {
					limit: 100,
					token: undefined
				}
			});
		});
	});

	describe("listTodos", () => {
		it("should return todos", async () => {
			const mockTodos = [
				{ id: "1", title: "Test", objective: "Work", completed: false },
			];
			mockStateQuery.mockResolvedValueOnce({
				results: [{ data: mockTodos[0] }],
			});
			const repo = new DaprRepo();
			const res = await repo.listTodos();
			expect(res).toEqual(mockTodos);
			expect(mockStateQuery).toHaveBeenCalledWith("todostore", {
				filter: {},
				sort: [],
				page: {
					limit: 100,
					token: undefined
				}
			});
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
			mockStateSave.mockResolvedValueOnce(undefined);

			const repo = new DaprRepo();
			const res = await repo.createTodo(newTodo);
			expect(res).toEqual(newTodo);
			expect(mockStateSave).toHaveBeenCalledWith("todostore", [
				{
					key: "1",
					value: newTodo,
					metadata: { partitionKey: "Work" },
				},
			]);
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

			mockStateGet.mockResolvedValueOnce(oldTodo);
			mockStateSave.mockResolvedValueOnce(undefined);

			const repo = new DaprRepo();
			const res = await repo.updateTodo("1", "Work", "New", true);

			expect(res).toEqual(newTodo);
			expect(mockStateGet).toHaveBeenCalledWith("todostore", "1", {
				metadata: { partitionKey: "Work" },
			});
			expect(mockStateSave).toHaveBeenCalledWith("todostore", [
				{
					key: "1",
					value: newTodo,
					metadata: { partitionKey: "Work" },
				},
			]);
		});

		it("should return null if todo not found via get", async () => {
			mockStateGet.mockResolvedValueOnce("");
			const repo = new DaprRepo();
			const res = await repo.updateTodo("1", "Work", "New", true);
			expect(res).toBeNull();
		});
	});

	describe("deleteTodo", () => {
		it("should delete and return true", async () => {
			mockStateGet.mockResolvedValueOnce({ id: "1" });
			mockStateDelete.mockResolvedValueOnce(undefined);
			const repo = new DaprRepo();
			const res = await repo.deleteTodo("1", "Work");
			expect(res).toBe(true);
			expect(mockStateGet).toHaveBeenCalledWith("todostore", "1", {
				metadata: { partitionKey: "Work" },
			});
			expect(mockStateDelete).toHaveBeenCalledWith("todostore", "1", {
				metadata: { partitionKey: "Work" },
			});
		});

		it("should return false if item not found", async () => {
			mockStateGet.mockResolvedValueOnce("");
			const repo = new DaprRepo();
			const res = await repo.deleteTodo("1", "Work");
			expect(res).toBe(false);
		});
	});
});
