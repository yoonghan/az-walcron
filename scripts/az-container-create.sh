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
  --connection-string "InstrumentationKey=2645c3a9-abeb-41c9-ba5e-5053b15aaf6c;IngestionEndpoint=https://southeastasia-1.in.applicationinsights.azure.com/;LiveEndpoint=https://southeastasia.livediagnostics.monitor.azure.com/;ApplicationId=8ef415fa-e1ae-429e-8e1c-d8b8f90ae66d" \
  --enable-open-telemetry-traces true \
  --enable-open-telemetry-logs true