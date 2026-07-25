import { Hono } from "hono";
import { v4 as uuidv4 } from "uuid";
import { dbRepo } from "../db";
import { logger } from "../logger";

type Variables = {
	requestId: string;
};

const todosRoutes = new Hono<{ Variables: Variables }>();

todosRoutes.get("/objective", async (c) => {
	try {
		const objectives = await dbRepo.listObjectives();
		return c.json(objectives);
	} catch (err: unknown) {
		logger.error(
			{
				err: err instanceof Error ? err.message : String(err),
				request_id: c.get("requestId"),
			},
			"Failed to list objectives",
		);
		return c.json({ error: "Internal Server Error" }, 500);
	}
});

todosRoutes.get("/", async (c) => {
	try {
		const todos = await dbRepo.listTodos();
		return c.json(todos);
	} catch (err: unknown) {
		logger.error(
			{
				err: err instanceof Error ? err.message : String(err),
				request_id: c.get("requestId"),
			},
			"Failed to list todos",
		);
		return c.json({ error: "Internal Server Error" }, 500);
	}
});

todosRoutes.post("/", async (c) => {
	try {
		const body = await c.req.json();
		const newTodo = {
			id: uuidv4(),
			objective: body.objective,
			title: body.title,
			completed: false,
		};
		const created = await dbRepo.createTodo(newTodo);
		return c.json(created, 201);
	} catch (err: unknown) {
		logger.error(
			{
				err: err instanceof Error ? err.message : String(err),
				request_id: c.get("requestId"),
			},
			"Failed to create todo",
		);
		return c.json({ error: "Internal Server Error" }, 500);
	}
});

todosRoutes.put("/:id", async (c) => {
	try {
		const id = c.req.param("id");
		const body = await c.req.json();
		const updated = await dbRepo.updateTodo(
			id,
			body.objective,
			body.title,
			body.completed,
		);

		if (!updated) {
			return c.json({ error: "Not found" }, 404);
		}
		return c.json(updated);
	} catch (err: unknown) {
		logger.error(
			{
				err: err instanceof Error ? err.message : String(err),
				request_id: c.get("requestId"),
			},
			"Failed to update todo",
		);
		return c.json({ error: "Internal Server Error" }, 500);
	}
});

todosRoutes.delete("/:id", async (c) => {
	try {
		const id = c.req.param("id");
		const objective = c.req.query("objective");

		if (!objective) {
			return c.json({ error: "Missing objective query parameter" }, 400);
		}

		const deleted = await dbRepo.deleteTodo(id, objective);
		if (!deleted) {
			return c.json({ error: "Not found" }, 404);
		}
		return new Response(null, { status: 204 });
	} catch (err: unknown) {
		logger.error(
			{
				err: err instanceof Error ? err.message : String(err),
				request_id: c.get("requestId"),
			},
			"Failed to delete todo",
		);
		return c.json({ error: "Internal Server Error" }, 500);
	}
});

export default todosRoutes;
