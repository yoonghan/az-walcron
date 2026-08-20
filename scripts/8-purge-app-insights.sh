
RESOURCE_GROUP="walcron-rg"
APP_NAME=walcron-application-insight
SUB_ID=1b7354d6-a407-4b91-a72a-009aa3805317
WORKSPACE_NAME=walcron-log-workspace
API_VERSION=2015-03-20

JSON: 
{
    "filters": [
    {
      "column": "_ResourceId",
      "operator": "==",
      "value": "/subscriptions/1b7354d6-a407-4b91-a72a-009aa3805317/resourcegroups/walcron-rg/providers/microsoft.insights/components/walcron-application-insight"
    }
  ],
  "table": "AppDependencies"
}

Search: Workspace Purge - Purge
Go https://learn.microsoft.com/en-us/rest/api/loganalytics/workspace-purge/purge?view=rest-loganalytics-2026-03-01&tabs=HTTP&tryIt=true&source=docs#code-try-0