import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockStateSave, mockStateGet, mockStateDelete, mockBindingSend } =
	vi.hoisted(() => {
		return {
			mockStateSave: vi.fn(),
			mockStateGet: vi.fn(),
			mockStateDelete: vi.fn(),
			mockBindingSend: vi.fn(),
		};
	});

vi.mock("@dapr/dapr", () => {
	return {
		DaprClient: class {
			state = {
				save: mockStateSave,
				get: mockStateGet,
				delete: mockStateDelete,
			};
			binding = {
				send: mockBindingSend,
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
			mockBindingSend.mockResolvedValueOnce(["Work", "Personal"]);
			const repo = new DaprRepo();
			const res = await repo.listObjectives();
			expect(res).toEqual(["Work", "Personal"]);
			expect(mockBindingSend).toHaveBeenCalledWith(
				"todoquery",
				"query",
				undefined,
				{ query: "SELECT DISTINCT VALUE c.objective FROM c" },
			);
		});
	});

	describe("listTodos", () => {
		it("should return todos", async () => {
			const mockTodos = [
				{ id: "1", title: "Test", objective: "Work", completed: false },
			];
			mockBindingSend.mockResolvedValueOnce(mockTodos);
			const repo = new DaprRepo();
			const res = await repo.listTodos();
			expect(res).toEqual(mockTodos);
			expect(mockBindingSend).toHaveBeenCalledWith(
				"todoquery",
				"query",
				undefined,
				{ query: "SELECT * FROM c" },
			);
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
				{ key: "1", value: newTodo },
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
			expect(mockStateGet).toHaveBeenCalledWith("todostore", "1");
			expect(mockStateSave).toHaveBeenCalledWith("todostore", [
				{ key: "1", value: newTodo },
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
			expect(mockStateGet).toHaveBeenCalledWith("todostore", "1");
			expect(mockStateDelete).toHaveBeenCalledWith("todostore", "1");
		});

		it("should return false if item not found", async () => {
			mockStateGet.mockResolvedValueOnce("");
			const repo = new DaprRepo();
			const res = await repo.deleteTodo("1", "Work");
			expect(res).toBe(false);
		});
	});
});
