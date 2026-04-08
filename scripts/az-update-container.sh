# Currently using latest, so just bumping it is enough.
# TODO going forward, will use github pipeline.
az containerapp update \
  --name walcron \
  --resource-group walcron-rg \
  --image ghcr.io/yoonghan/az-walcron:latest

az containerapp ingress cors enable \
  --name walcron \
  --resource-group walcron-rg \
  --allowed-origins "https://www.walcron.com" "https://yoonghan.github.io" \
  --allow-credentials true \
  --allowed-methods "GET, POST, PUT, DELETE, OPTIONS" \
  --allowed-headers "*"