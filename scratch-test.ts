import { DaprClient } from "@dapr/dapr";
import { CommunicationProtocolEnum } from "@dapr/dapr/enum/CommunicationProtocol.enum";

const client = new DaprClient({ daprHost: "127.0.0.1", daprPort: "3500", communicationProtocol: CommunicationProtocolEnum.HTTP });
console.log(client);
