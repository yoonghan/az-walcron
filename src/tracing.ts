import { useAzureMonitor } from "@azure/monitor-opentelemetry";
import { ZipkinExporter } from '@opentelemetry/exporter-zipkin';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from "@opentelemetry/sdk-node";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';


// 1. Initialize Azure Monitor (for production/cloud)
if (process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
	console.log("OTel: Application Insights connection string found. Initializing Azure Monitor.");
	useAzureMonitor();
}

// 2.1
const exporter = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING
	? new OTLPTraceExporter() // Azure uses OTLP by default
	: new ZipkinExporter({ url: 'http://localhost:9411/api/v2/spans' });

// 2.2 We use our own NodeSDK to ADD the console exporter and extra instrumentations.
// OpenTelemetry is smart enough to merge these configurations.
const sdk = new NodeSDK({
	resource: resourceFromAttributes({
		[ATTR_SERVICE_NAME]: "az-walcron",
		[ATTR_SERVICE_VERSION]: "1.0.0",
	}),
	traceExporter: exporter,
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