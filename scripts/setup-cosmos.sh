#!/bin/bash
# setup-cosmos.sh

ACCOUNT_NAME=walcron-db
APP_NAME=walcron
RESOURCE_GROUP="walcron-rg"
DATABASE_NAME="TodoDatabase"
CONTAINER_NAME="Todos"
SUB_ID="1b7354d6-a407-4b91-a72a-009aa3805317"

echo "Creating Database: $DATABASE_NAME..."
az cosmosdb sql database create \
  --account-name $ACCOUNT_NAME \
  --resource-group $RESOURCE_GROUP \
  --name $DATABASE_NAME

echo "Creating Container: $CONTAINER_NAME with partition key /objective..."
az cosmosdb sql container create \
  --account-name $ACCOUNT_NAME \
  --resource-group $RESOURCE_GROUP \
  --database-name $DATABASE_NAME \
  --name $CONTAINER_NAME \
  --partition-key-path "/objective"

echo "Enabling System-Assigned Managed Identity for $APP_NAME..."
az containerapp identity assign \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP

PRINCIPAL_ID=$(az containerapp show \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --query "identity.principalId" -o tsv)

echo "Assigning 'Cosmos DB Built-in Data Contributor' role to Principal ID: $PRINCIPAL_ID..."
# Role Definition ID for 'Cosmos DB Built-in Data Contributor' is 00000000-0000-0000-0000-000000000002
az cosmosdb sql role assignment create \
  --account-name walcron-db \
  --resource-group walcron-rg \
  --role-definition-id "00000000-0000-0000-0000-000000000002" \
  --principal-id $PRINCIPAL_ID \
  --scope "/"

echo "Assigning 'Cosmos DB Account Reader Role' role to Principal ID: $PRINCIPAL_ID..."
# Role Definition ID for 'Cosmos DB Built-in Data Contributor' is 00000000-0000-0000-0000-000000000002
az role assignment create \
  --assignee $PRINCIPAL_ID \
  --role "Cosmos DB Account Reader Role" \
  --scope "/subscriptions/$SUB_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.DocumentDB/databaseAccounts/$ACCOUNT_NAME"

echo "Disabling local (key-based) authentication for $ACCOUNT_NAME..."
az resource update \
  --resource-group $RESOURCE_GROUP \
  --name $ACCOUNT_NAME \
  --resource-type "Microsoft.DocumentDB/databaseAccounts" \
  --set properties.disableLocalAuth=true

echo "Updating Firewall to allow all internet services and ACA..."
az cosmosdb update \
  --name $ACCOUNT_NAME \
  --resource-group $RESOURCE_GROUP \
  --public-network-access Enabled \
  --ip-range-filter ""

echo "CosmosDB setup complete."
echo "Please set the following environment variables in your Container App:"
echo "COSMOS_ENDPOINT=https://$ACCOUNT_NAME.documents.azure.com:443/"
echo "COSMOS_DATABASE=$DATABASE_NAME"
echo "COSMOS_CONTAINER=$CONTAINER_NAME"
