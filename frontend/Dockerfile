FROM denoland/deno:alpine-1.39.0

WORKDIR /app

# Cache dependencies
COPY server.ts .
RUN deno cache server.ts

EXPOSE 8080

CMD ["run", "--allow-net", "server.ts"]
