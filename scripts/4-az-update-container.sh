# Currently using latest, so just bumping it is enough.
# TODO going forward, will use github pipeline.

# Ensure we're in the right directory to find the containerapp.yaml
SCRIPT_DIR="$(dirname "$0")"

az containerapp update \
  --name walcron \
  --resource-group walcron-rg \
  --yaml "$SCRIPT_DIR/containerapp.yaml"

echo "Linking Application Insights to Container App..."
az containerapp connection create app-insights \
  --resource-group walcron-rg \
  --name walcron \
  --target-resource-group walcron-rg \
  --app-insights walcron-application-insight \
  --client-type nodejs \
  --container walcron \
  --connection walcron_appinsights_conn \
  --secret