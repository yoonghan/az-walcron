import { useAzureMonitor } from "@azure/monitor-opentelemetry";
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-base";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";

// 1. Initialize Azure Monitor (for production/cloud)
if (process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
	useAzureMonitor();
}

// 2. Setup the Local SDK (for your MacBook console logging)
const sdk = new NodeSDK({
	traceExporter: new ConsoleSpanExporter(),
	instrumentations: [new HttpInstrumentation()],
	// This automatically sets up the Span Processor for the Console Exporter
});

// 3. Start the SDK
try {
	sdk.start();
	console.log("OTel: NodeSDK started. Logging to console enabled.");
} catch (error) {
	console.error("Error starting OTel SDK", error);
}

// Graceful shutdown
process.on('SIGTERM', () => {
	sdk.shutdown()
		.then(() => console.log('Tracing terminated'))
		.catch((error: unknown) => console.log('Error terminating tracing', error))
		.finally(() => process.exit(0));
});