# ─── Stage 1: Compute the dependency recipe ──────────────────────────────────
# cargo-chef "plans" which dependencies to cache, based on Cargo.toml/lock only.
FROM rust:alpine AS planner
WORKDIR /app
RUN apk add --no-cache musl-dev
RUN cargo install cargo-chef --locked
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo chef prepare --recipe-path recipe.json

# ─── Stage 2: Cache dependencies ─────────────────────────────────────────────
# This layer is only invalidated when Cargo.toml/Cargo.lock changes.
# rustls replaces vendored OpenSSL, so no perl/make/gcc needed here.
FROM rust:alpine AS builder
WORKDIR /app
RUN apk add --no-cache musl-dev
RUN cargo install cargo-chef --locked
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json

# ─── Stage 3: Build the application binary ───────────────────────────────────
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

# ─── Stage 4: Minimal runtime image (<15 MB) ──────────────────────────────────
FROM alpine:3.19
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=builder /app/target/release/todo-server /usr/local/bin/todo-server
EXPOSE 3000
ENTRYPOINT ["todo-server"]
