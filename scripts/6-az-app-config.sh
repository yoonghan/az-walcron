export RESOURCE_GROUP="walcron-rg"
export APPCONFIG_NAME="walcronconfig"
export CONTAINER_APP_NAME="walcron"

az appconfig create -g $RESOURCE_GROUP -n $APP_NAME -l southeastasia --sku Free

echo "Creating App Config: $APP_NAME..."

PRINCIPAL_ID=$(az containerapp show \
  --name $CONTAINER_APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --query "identity.principalId" \
  --output tsv)

# 2. Get the Resource ID of your App Configuration store
APPCONFIG_ID=$(az appconfig show \
  --name $APPCONFIG_NAME \
  --resource-group $RESOURCE_GROUP \
  --query "id" \
  --output tsv)

# 3. Create the role assignment
az role assignment create \
  --assignee $PRINCIPAL_ID \
  --role "App Configuration Data Reader" \
  --scope $APPCONFIG_ID

az appconfig kv set \
  --name walcronconfig \
  --key openai:messagePrompt \
  --value "gpt-5-mini" \
  --yes
  
az appconfig kv set \
  --name walcronconfig \
  --key openai:version \
  --value "2025-04-01-preview" \
  --yes