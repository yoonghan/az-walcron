# Currently using latest, so just bumping it is enough.
# TODO going forward, will use github pipeline.
az containerapp update \
  --name walcron \
  --resource-group walcron-rg \
  --image ghcr.io/yoonghan/az-walcron:latest