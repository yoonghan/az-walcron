# az-container-create.sh yoonghan 
# 1. Create the Container App Environment (The 'Sandbox')
az containerapp env create --name walcron-env --resource-group walcron-rg --location southeastasia

# 2. Deploy the App with Scale-to-Zero using YAML configuration
az containerapp create \
  --name walcron \
  --resource-group walcron-rg \
  --environment walcron-env \
  --yaml containerapp.yaml \
  --registry-server ghcr.io \
  --registry-username $1 \
  --registry-password $2

# 3. Create OTEL connection
az containerapp env telemetry app-insights set \
  --name walcron-env \
  --resource-group walcron-rg \
  --connection-string "InstrumentationKey=deef89a4-0c02-417e-a0e7-be94a52d78a9;IngestionEndpoint=https://eastasia-0.in.applicationinsights.azure.com/;LiveEndpoint=https://eastasia.livediagnostics.monitor.azure.com/;ApplicationId=639678ac-5870-4688-bc6c-6324421753c1" \
  --enable-open-telemetry-traces true \
  --enable-open-telemetry-logs true