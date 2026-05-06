import { DaprClient } from "@dapr/dapr";
const client = new DaprClient({ daprHost: "127.0.0.1", daprPort: "3500" });
async function run() {
  try {
    const res = await client.state.query("todostore", {
        filter: {}
    });
    console.log("Query success:", res);
  } catch (e) {
    console.error("Query error:", e);
  }
}
run();
