#!/bin/bash
# 7-az-aks-provision.sh
# End-to-end script to provision AKS with Workload Identity, Dapr, and NGINX Ingress

if [ -z "$1" ] || [ -z "$2" ]; then
  echo "Usage: $0 <ghcr-username> <ghcr-password-or-pat>"
  exit 1
fi

GHCR_USERNAME=$1
GHCR_PASSWORD=$2

export RESOURCE_GROUP="walcron-rg"
export LOCATION="southeastasia"
export CLUSTER_NAME="walcron-aks"
export UAMI_NAME="walcron-workload-id"
export NAMESPACE="walcron-app"
export SERVICE_ACCOUNT_NAME="walcron-sa"
export APPCONFIG_NAME="walcronconfig"
export COSMOS_ACCOUNT_NAME="walcron-cosmosdb"

echo "1. Registering required resource providers (if not already registered)..."
az provider register --namespace Microsoft.ContainerService

echo "2. Creating User-Assigned Managed Identity (UAMI) for Workload Identity..."
az identity create --name $UAMI_NAME --resource-group $RESOURCE_GROUP --location $LOCATION

UAMI_CLIENT_ID=$(az identity show --name $UAMI_NAME --resource-group $RESOURCE_GROUP --query 'clientId' -o tsv)
UAMI_PRINCIPAL_ID=$(az identity show --name $UAMI_NAME --resource-group $RESOURCE_GROUP --query 'principalId' -o tsv)

echo "3. Creating AKS Cluster with OIDC Issuer and Workload Identity enabled..."
# Using 1 node for development/cost-saving.
az aks create \
  --resource-group $RESOURCE_GROUP \
  --name $CLUSTER_NAME \
  --location $LOCATION \
  --node-count 1 \
  --enable-oidc-issuer \
  --enable-workload-identity \
  --network-plugin azure \
  --generate-ssh-keys

echo "4. Getting AKS credentials..." 
az aks get-credentials --resource-group $RESOURCE_GROUP --name $CLUSTER_NAME --overwrite-existing

echo "5. Getting AKS OIDC Issuer URL..."
AKS_OIDC_ISSUER=$(az aks show --resource-group $RESOURCE_GROUP --name $CLUSTER_NAME --query "oidcIssuerProfile.issuerUrl" -o tsv)

echo "6. Creating Kubernetes Namespace and Service Account..."
kubectl create namespace $NAMESPACE || true

cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: ServiceAccount
metadata:
  name: $SERVICE_ACCOUNT_NAME
  namespace: $NAMESPACE
  annotations:
    azure.workload.identity/client-id: "$UAMI_CLIENT_ID"
EOF

echo "7. Establishing Federated Identity Credential..."
az identity federated-credential create \
  --name walcron-federated-id \
  --identity-name $UAMI_NAME \
  --resource-group $RESOURCE_GROUP \
  --issuer "$AKS_OIDC_ISSUER" \
  --subject "system:serviceaccount:$NAMESPACE:$SERVICE_ACCOUNT_NAME" \
  --audiences "api://AzureADTokenExchange"

echo "8. Assigning Roles to the UAMI..."
# Assign App Config Reader Role
APPCONFIG_ID=$(az appconfig show --name $APPCONFIG_NAME --resource-group $RESOURCE_GROUP --query "id" --output tsv)
if [ -n "$APPCONFIG_ID" ]; then
    echo "Assigning App Configuration Data Reader role..."
    az role assignment create \
      --assignee $UAMI_PRINCIPAL_ID \
      --role "App Configuration Data Reader" \
      --scope $APPCONFIG_ID
fi

# Assign Cosmos DB Roles
SUB_ID=$(az account show --query id -o tsv)
COSMOS_RESOURCE_ID="/subscriptions/$SUB_ID/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.DocumentDB/databaseAccounts/$COSMOS_ACCOUNT_NAME"

echo "Assigning Cosmos DB Built-in Data Contributor role..."
# Role ID 00000000-0000-0000-0000-000000000002 is Built-in Data Contributor
az cosmosdb sql role assignment create \
  --account-name $COSMOS_ACCOUNT_NAME \
  --resource-group $RESOURCE_GROUP \
  --role-definition-id "00000000-0000-0000-0000-000000000002" \
  --principal-id $UAMI_PRINCIPAL_ID \
  --scope "/"

echo "Assigning Cosmos DB Account Reader Role..."
az role assignment create \
  --assignee $UAMI_PRINCIPAL_ID \
  --role "Cosmos DB Account Reader Role" \
  --scope $COSMOS_RESOURCE_ID

echo "9. Installing Dapr on AKS via Helm..."
if ! command -v helm &> /dev/null; then
    echo "Helm could not be found. Please install Helm to continue with Dapr and NGINX Ingress."
    exit 1
fi

helm repo add dapr https://dapr.github.io/helm-charts/
helm repo update
helm upgrade --install dapr dapr/dapr \
  --version=1.13 \
  --namespace dapr-system \
  --create-namespace \
  --wait

echo "10. Installing NGINX Ingress Controller..."
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-basic \
  --create-namespace \
  --set controller.replicaCount=1 \
  --set controller.nodeSelector."kubernetes\.io/os"=linux \
  --set defaultBackend.nodeSelector."kubernetes\.io/os"=linux \
  --wait

echo "11. Creating GHCR Image Pull Secret..."
kubectl create secret docker-registry ghcr-secret \
  --namespace $NAMESPACE \
  --docker-server=ghcr.io \
  --docker-username=$GHCR_USERNAME \
  --docker-password=$GHCR_PASSWORD \
  --docker-email="noreply@example.com" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "========================================="
echo "AKS Provisioning Complete!"
echo "========================================="
echo "Please review the script logic before executing."
echo "Note: You will need to make executable with: chmod +x scripts/7-az-aks-provision.sh"
