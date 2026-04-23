import { useAzureMonitor } from "@azure/monitor-opentelemetry";

// If Azure Container Apps is configured with Application Insights natively
// (e.g. via `az containerapp env telemetry app-insights set`),
// this single call automatically detects all necessary configurations.
useAzureMonitor();

console.log("Azure Monitor OpenTelemetry initialized.");
