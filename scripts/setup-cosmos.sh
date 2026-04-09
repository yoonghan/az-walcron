#!/bin/bash
# setup-cosmos.sh
# App name should be walcron
# Usage: ./scripts/setup-cosmos.sh <COSMOS_ACCOUNT_NAME> <APP_NAME>

if [ -z "$1" ] || [ -z "$2" ]; then
  echo "Usage: ./scripts/setup-cosmos.sh <COSMOS_ACCOUNT_NAME> <APP_NAME>"
  exit 1
fi

ACCOUNT_NAME=$1
APP_NAME=$2
RESOURCE_GROUP="walcron-rg"
DATABASE_NAME="TodoDatabase"
CONTAINER_NAME="Todos"

echo "Creating Database: $DATABASE_NAME..."
az cosmosdb sql database create \
  --account-name $ACCOUNT_NAME \
  --resource-group $RESOURCE_GROUP \
  --name $DATABASE_NAME

echo "Creating Container: $CONTAINER_NAME with partition key /id..."
az cosmosdb sql container create \
  --account-name $ACCOUNT_NAME \
  --resource-group $RESOURCE_GROUP \
  --database-name $DATABASE_NAME \
  --name $CONTAINER_NAME \
  --partition-key-path "/id"

echo "Enabling System-Assigned Managed Identity for $APP_NAME..."
PRINCIPAL_ID=$(az containerapp identity assign \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --query "principalId" -o tsv)

echo "Assigning 'Cosmos DB Built-in Data Contributor' role to Principal ID: $PRINCIPAL_ID..."
# Role Definition ID for 'Cosmos DB Built-in Data Contributor' is 00000000-0000-0000-0000-000000000002
az cosmosdb sql role assignment create \
  --account-name $ACCOUNT_NAME \
  --resource-group $RESOURCE_GROUP \
  --role-definition-id "00000000-0000-0000-0000-000000000002" \
  --principal-id $PRINCIPAL_ID \
  --scope "/"

echo "CosmosDB setup complete."
echo "Please set the following environment variables in your Container App:"
echo "COSMOS_ENDPOINT=https://$ACCOUNT_NAME.documents.azure.com:443/"
echo "COSMOS_DATABASE=$DATABASE_NAME"
echo "COSMOS_CONTAINER=$CONTAINER_NAME"
