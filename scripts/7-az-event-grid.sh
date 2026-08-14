export RESOURCE_GROUP="walcron-rg"
export APPCONFIG_NAME="walcronconfig"
export EVENT_SUBSCRIPTION_NAME="appconfig-sentinel-sub"
export WEBHOOK_ENDPOINT="https://azure.walcron.com/admin/config/refresh"

echo "Registering Microsoft.EventGrid provider..."
az provider register --namespace Microsoft.EventGrid

# Get the Resource ID of your App Configuration store
APPCONFIG_ID=$(az appconfig show \
  --name $APPCONFIG_NAME \
  --resource-group $RESOURCE_GROUP \
  --query "id" \
  --output tsv)

echo "Creating Event Grid Event Subscription for App Configuration..."
az eventgrid event-subscription create \
  --name $EVENT_SUBSCRIPTION_NAME \
  --source-resource-id $APPCONFIG_ID \
  --endpoint $WEBHOOK_ENDPOINT \
  --endpoint-type webhook \
  --included-event-types Microsoft.AppConfiguration.KeyValueModified \
  --advanced-filter data.key StringIn Sentinel

