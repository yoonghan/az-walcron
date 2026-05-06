# az-container-create.sh yoonghan 
# 1. Create Log Analytics Workspace explicitly to link to Application Insights
echo "Creating Log Analytics Workspace..."
az monitor log-analytics workspace create \
  --resource-group walcron-rg \
  --workspace-name walcron-log-workspace \
  --location southeastasia

LOG_WORKSPACE_ID=$(az monitor log-analytics workspace show --resource-group walcron-rg --workspace-name walcron-log-workspace --query id -o tsv)
LOG_WORKSPACE_CLIENT_ID=$(az monitor log-analytics workspace show --resource-group walcron-rg --workspace-name walcron-log-workspace --query customerId -o tsv)
LOG_WORKSPACE_SECRET=$(az monitor log-analytics workspace get-shared-keys --resource-group walcron-rg --workspace-name walcron-log-workspace --query primarySharedKey -o tsv)

# 2. Create the Container App Environment (The 'Sandbox')
echo "Creating Container App Environment..."
az containerapp env create \
  --name walcron-env \
  --resource-group walcron-rg \
  --location southeastasia \
  --logs-workspace-id $LOG_WORKSPACE_CLIENT_ID \
  --logs-workspace-key $LOG_WORKSPACE_SECRET

# 2.5. Add Dapr Components to the Environment
echo "Deploying Dapr Components to Environment..."
az containerapp env dapr-component set \
  --name walcron-env \
  --resource-group walcron-rg \
  --dapr-component-name todostore \
  --yaml dapr-statestore.yaml

az containerapp env dapr-component set \
  --name walcron-env \
  --resource-group walcron-rg \
  --dapr-component-name todoquery \
  --yaml dapr-cosmosquery.yaml


# 3. Create Application Insights linked to the Log Analytics Workspace
echo "Creating Application Insights component..."
az monitor app-insights component create \
  --app walcron-application-insight \
  --location southeastasia \
  --kind web \
  --resource-group walcron-rg \
  --workspace $LOG_WORKSPACE_ID

# 4. Deploy the App with Scale-to-Zero using YAML configuration
echo "Deploying Container App..."
az containerapp create \
  --name walcron \
  --resource-group walcron-rg \
  --environment walcron-env \
  --yaml containerapp.yaml \
  --registry-server ghcr.io \
  --registry-username $1 \
  --registry-password $2

# 5. Create Application connection
echo "Linking Application Insights to Container App..."
az containerapp connection create app-insights \
  --resource-group walcron-rg \
  --name walcron \
  --target-resource-group walcron-rg \
  --app-insights walcron-application-insight \
  --client-type nodejs \
  --container walcron