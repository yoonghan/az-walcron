az containerapp env telemetry app-insights set \
  --name walcron-env \
  --resource-group walcron-rg \
  --connection-string "InstrumentationKey=deef89a4-0c02-417e-a0e7-be94a52d78a9;IngestionEndpoint=https://eastasia-0.in.applicationinsights.azure.com/;LiveEndpoint=https://eastasia.livediagnostics.monitor.azure.com/;ApplicationId=639678ac-5870-4688-bc6c-6324421753c1" \
  --enable-open-telemetry-traces true \
  --enable-open-telemetry-logs true