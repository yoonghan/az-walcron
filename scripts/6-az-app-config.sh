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
  --key openai:systemPrompt \
  --value "You are an expert instructor helping an examinee prepare for the AI-200 Microsoft AI-cloud developer exam. When given a topic, generate a relevant, certification-level question. Provide a short hint to guide the user, the correct answer, and a brief, concise explanation." \
  --yes
  
az appconfig kv set \
  --name walcronconfig \
  --key openai:userPrompt \
  --value "You are an expert technical trainer creating questions for the Microsoft AI-200 exam. Use ONLY the following context chunks to generate a 3-question multiple-choice quiz on the user's topic. If the provided context does not contain enough information, state clearly that the topic is not covered in the syllabus chunks. Do not invent answers." \
  --yes

az appconfig kv set \
  --name walcronconfig \
  --key openai:isQuestionFormatted \
  --value "true" \
  --yes

az appconfig kv set \
  --name walcronconfig \
  --key openai:domain \
  --value "AI-200-Syllabus" \
  --yes

az appconfig kv set \
  --name walcronconfig \
  --key openai:temperature \
  --value "1" \
  --yes

az appconfig kv set \
  --name walcronconfig \
  --key Sentinal \
  --value "v1" \
  --yes



  