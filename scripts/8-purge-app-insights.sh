
RESOURCE_GROUP="walcron-rg"
APP_NAME=walcron-application-insight
SUB_ID=1b7354d6-a407-4b91-a72a-009aa3805317
WORKSPACE_NAME=walcron-log-workspace
API_VERSION=2015-03-20

JSON: 
{
  "filters": [
    {
      "column": "TimeGenerated",
      "operator": ">",
      "value": "2017-09-01T00:00:00"
    }
  ],
  "table": "AppDependencies"
}

Search: Workspace Purge - Purge
Go https://learn.microsoft.com/en-us/rest/api/loganalytics/workspace-purge/purge?view=rest-loganalytics-2026-03-01&tabs=HTTP&tryIt=true&source=docs#code-try-0