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