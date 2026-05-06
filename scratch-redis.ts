import { DaprClient, CommunicationProtocolEnum } from "@dapr/dapr";
const client = new DaprClient({ daprHost: "127.0.0.1", daprPort: "3500", communicationProtocol: CommunicationProtocolEnum.HTTP });
async function test() {
  try {
    await client.state.save("statestore", [{ key: "test", value: { id: "test", objective: "test" } }]);
    const res = await client.state.query("statestore", { filter: {} });
    console.log("Success:", JSON.stringify(res, null, 2));
  } catch (e) {
    console.error("Error:", e.message || e);
  }
}
test();
