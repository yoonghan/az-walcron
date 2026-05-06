import { DaprClient } from "@dapr/dapr";
const client = new DaprClient({ daprHost: "127.0.0.1", daprPort: "3500" });
async function test() {
  await client.state.save("todostore", [{ key: "test", value: { id: "test", objective: "test", title: "test", completed: false } }]);
  const res = await client.state.query("todostore", { filter: {} });
  console.log("Raw response results[0]:", res.results[0]);
}
test().catch(console.error);
