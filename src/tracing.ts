import { useAzureMonitor } from "@azure/monitor-opentelemetry";
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-base";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';


// 1. Initialize Azure Monitor (for production/cloud)
if (process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
	console.log("OTel: Application Insights connection string found. Initializing Azure Monitor.");
	console.log("OTel: Application Insights connection string: ", process.env.APPLICATIONINSIGHTS_CONNECTION_STRING);
	useAzureMonitor();
}

// 2. We use our own NodeSDK to ADD the console exporter and extra instrumentations.
// OpenTelemetry is smart enough to merge these configurations.
const sdk = new NodeSDK({
	resource: resourceFromAttributes({
		[ATTR_SERVICE_NAME]: "az-walcron",
		[ATTR_SERVICE_VERSION]: "1.0.0",
	}),
	traceExporter: new ConsoleSpanExporter(),
	instrumentations: [
		// No special config needed for basic propagation!
		new HttpInstrumentation(),
		// Essential for linking Hono -> Dapr or Hono -> Hono calls
		new UndiciInstrumentation(),
	],
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