import { useAzureMonitor } from "@azure/monitor-opentelemetry";
import { ZipkinExporter } from '@opentelemetry/exporter-zipkin';
import { NodeSDK } from "@opentelemetry/sdk-node";
// REMOVED - Using Azure to track http calls.request calls
// import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION, ATTR_SERVICE_INSTANCE_ID } from '@opentelemetry/semantic-conventions';
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { logger } from "./logger"

const resourceAttribute = resourceFromAttributes({
	[ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || "az-walcron",
	[ATTR_SERVICE_VERSION]: process.env.OTEL_SERVICE_NAMESPACE || "1.0.0",
	[ATTR_SERVICE_INSTANCE_ID]: process.env.OTEL_SERVICE_INSTANCE_ID || "walcron-instance",
})

/** 
 * HttpInstrumentation works via monkey-patching — it patches Node.js's built-in http and https modules at the global level. After this, any code in the process that uses http.request() / http.get() (including @hono/node-server's serve()) automatically gets traced. Hono doesn't "know" about it — the patching happens underneath it.
 * UndiciInstrumentation does the same for fetch() / undici — so outgoing calls from your Hono handlers (e.g., to Dapr or other services) also get traced.
 * **/
const sharedInstrumentations = [
	// REMOVED - Using Azure to track http.request calls
	// new HttpInstrumentation(),
	// Essential for linking Hono -> Dapr or Hono -> Hono calls
	new UndiciInstrumentation(),
];

// 1. Initialize Azure Monitor (for production/cloud)
if (process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
	logger.info(`OTel: Application Insights connection string found. Initializing Azure Monitor with ${process.env.OTEL_SERVICE_NAME}.`);
	useAzureMonitor({
		resource: resourceAttribute,
		instrumentationOptions: {
			azureSdk: { enabled: false }, // Prevent ESM bundle crash for tracing bridge
			mongoDb: {
				enabled: true
			},
			// REMOVED - Using Azure to track http calls.request calls
			// http: {
			// 	enabled: false // Disabled because we register HttpInstrumentation globally below
			// }
		},
		azureMonitorExporterOptions: {
			connectionString: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING
		},
	});
} else {
	// 2. We use our own NodeSDK to ADD the console exporter and extra instrumentations.
	// OpenTelemetry is smart enough to merge these configurations.
	const sdk = new NodeSDK({
		resource: resourceAttribute,
		traceExporter: new ZipkinExporter({ url: 'http://localhost:9411/api/v2/spans' }),
	});

	// 3. Start the SDK
	try {
		sdk.start();
		logger.info("OTel: NodeSDK started. Logging to console enabled.");
	} catch (error) {
		logger.error(error, "Error starting OTel SDK");
	}

	// Graceful shutdown
	process.on('SIGTERM', () => {
		sdk.shutdown()
			.then(() => logger.info('Tracing terminated'))
			.catch((error: unknown) => logger.error(error, 'Error terminating tracing'))
			.finally(() => process.exit(0));
	});
}

registerInstrumentations({
	instrumentations: sharedInstrumentations
});


/* 
Error after start up.
026-05-11T08:59:10.0044271Z stdout F   'Failed to load JSON config file values.',
2026-05-11T08:59:10.0044298Z stdout F   [
2026-05-11T08:59:10.0044317Z stdout F     TypeError [ERR_INVALID_ARG_TYPE]: The "path" argument must be of type string or an instance of URL. Received undefined
2026-05-11T08:59:10.0044338Z stdout F         at fileURLToPath (node:internal/url:1487:11)
2026-05-11T08:59:10.0044371Z stdout F         at dirName (/app/index.js:52903:75)
2026-05-11T08:59:10.0044389Z stdout F         at new _JsonConfig (/app/index.js:52965:59)
2026-05-11T08:59:10.0044407Z stdout F         at _JsonConfig.getInstance (/app/index.js:52950:35)
2026-05-11T08:59:10.0044425Z stdout F         at InternalConfig._mergeJsonConfig (/app/index.js:54817:41)
2026-05-11T08:59:10.0044443Z stdout F         at new InternalConfig (/app/index.js:54806:14)
2026-05-11T08:59:10.0044462Z stdout F         at useAzureMonitor (/app/index.js:107330:19)
2026-05-11T08:59:10.0044482Z stdout F         at src/tracing.ts (/app/index.js:157079:7)
2026-05-11T08:59:10.0044499Z stdout F         at __require (/app/index.js:12:51)
2026-05-11T08:59:10.0044516Z stdout F         at Object.<anonymous> (/app/index.js:238047:30) {
2026-05-11T08:59:10.0044535Z stdout F       code: 'ERR_INVALID_ARG_TYPE'
2026-05-11T08:59:10.0044556Z stdout F     }
2026-05-11T08:59:10.0044573Z stdout F   ]
2026-05-11T08:59:10.0044592Z stdout F ]
*/