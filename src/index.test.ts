import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock tracing as it attempts to connect to Azure Application Insights
vi.mock("./tracing", () => ({}));

import app from "./index";

// Mock dbRepo
vi.mock("./db", () => ({
	dbRepo: {
		listObjectives: vi.fn(),
		listTodos: vi.fn(),
		createTodo: vi.fn(),
		updateTodo: vi.fn(),
		deleteTodo: vi.fn(),
	},
}));

import { dbRepo } from "./db";

describe("API Routes", () => {
	beforeEach(() => {
		vi.resetAllMocks();
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
			expect(await res.json()).toEqual({ openai: "3.1.0", info: { title: "Walcron AI API", version: "1.0.0" }, paths: {} });
		});
	});

	describe("GET /objectives", () => {
		it("should return list of objectives", async () => {
			vi.mocked(dbRepo.listObjectives).mockResolvedValue(["Work", "Personal"]);
			const res = await app.request("/objectives");
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual(["Work", "Personal"]);
		});

		it("should return 500 on db error", async () => {
			vi.mocked(dbRepo.listObjectives).mockRejectedValue(new Error("DB Error"));
			const res = await app.request("/objectives");
			expect(res.status).toBe(500);
		});
	});

	describe("GET /todos", () => {
		it("should return list of todos", async () => {
			const mockTodos = [
				{ id: "1", objective: "Work", title: "Task 1", completed: false },
			];
			vi.mocked(dbRepo.listTodos).mockResolvedValue(mockTodos);
			const res = await app.request("/todos");
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual(mockTodos);
		});

		it("should return 500 on db error", async () => {
			vi.mocked(dbRepo.listTodos).mockRejectedValue(new Error("DB Error"));
			const res = await app.request("/todos");
			expect(res.status).toBe(500);
		});
	});

	describe("POST /todos", () => {
		it("should create and return a new todo", async () => {
			const newTodo = {
				id: "some-id",
				objective: "Work",
				title: "Task 2",
				completed: false,
			};
			vi.mocked(dbRepo.createTodo).mockResolvedValue(newTodo);

			const res = await app.request("/todos", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ objective: "Work", title: "Task 2" }),
			});

			expect(res.status).toBe(201);
			const body = await res.json();
			expect(body).toEqual(newTodo);
			// Validate that createTodo was called with the right data structure (id and completed auto-filled)
			expect(dbRepo.createTodo).toHaveBeenCalledWith(
				expect.objectContaining({
					objective: "Work",
					title: "Task 2",
					completed: false,
				}),
			);
		});

		it("should return 500 on db error", async () => {
			vi.mocked(dbRepo.createTodo).mockRejectedValue(new Error("DB Error"));
			const res = await app.request("/todos", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ objective: "Work", title: "Task 2" }),
			});
			expect(res.status).toBe(500);
		});
	});

	describe("PUT /todos/:id", () => {
		it("should update and return the todo", async () => {
			const updatedTodo = {
				id: "1",
				objective: "Work",
				title: "Task 1 Updated",
				completed: true,
			};
			vi.mocked(dbRepo.updateTodo).mockResolvedValue(updatedTodo);

			const res = await app.request("/todos/1", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					objective: "Work",
					title: "Task 1 Updated",
					completed: true,
				}),
			});

			expect(res.status).toBe(200);
			expect(await res.json()).toEqual(updatedTodo);
			expect(dbRepo.updateTodo).toHaveBeenCalledWith(
				"1",
				"Work",
				"Task 1 Updated",
				true,
			);
		});

		it("should return 404 if todo not found", async () => {
			vi.mocked(dbRepo.updateTodo).mockResolvedValue(null);

			const res = await app.request("/todos/999", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					objective: "Work",
					title: "Task 1 Updated",
					completed: true,
				}),
			});

			expect(res.status).toBe(404);
		});

		it("should return 500 on db error", async () => {
			vi.mocked(dbRepo.updateTodo).mockRejectedValue(new Error("DB Error"));

			const res = await app.request("/todos/1", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					objective: "Work",
					title: "Task 1 Updated",
					completed: true,
				}),
			});

			expect(res.status).toBe(500);
		});
	});

	describe("DELETE /todos/:id", () => {
		it("should delete and return 204", async () => {
			vi.mocked(dbRepo.deleteTodo).mockResolvedValue(true);

			const res = await app.request("/todos/1?objective=Work", {
				method: "DELETE",
			});

			expect(res.status).toBe(204);
			expect(await res.text()).toBe("");
			expect(dbRepo.deleteTodo).toHaveBeenCalledWith("1", "Work");
		});

		it("should return 400 if objective query is missing", async () => {
			const res = await app.request("/todos/1", {
				method: "DELETE",
			});

			expect(res.status).toBe(400);
			expect(await res.json()).toEqual({
				error: "Missing objective query parameter",
			});
		});

		it("should return 404 if todo not found", async () => {
			vi.mocked(dbRepo.deleteTodo).mockResolvedValue(false);

			const res = await app.request("/todos/999?objective=Work", {
				method: "DELETE",
			});

			expect(res.status).toBe(404);
		});

		it("should return 500 on db error", async () => {
			vi.mocked(dbRepo.deleteTodo).mockRejectedValue(new Error("DB Error"));

			const res = await app.request("/todos/1?objective=Work", {
				method: "DELETE",
			});

			expect(res.status).toBe(500);
		});
	});
});
