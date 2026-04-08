FROM rust:1.76-alpine AS builder
WORKDIR /usr/src/app

# the musl-dev package is necessary to build Rust projects on Alpine
RUN apk add --no-cache musl-dev

# Create dummy project for dependency caching
COPY Cargo.toml ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release
RUN rm -rf src

# Copy real source code
COPY src ./src
# Touch the file to ensure Cargo builds it instead of using the dummy from cache
RUN touch src/main.rs
RUN cargo build --release

# Runner stage
FROM alpine:3.19
WORKDIR /app
COPY --from=builder /usr/src/app/target/release/todo-server /usr/local/bin/todo-server

EXPOSE 3000
ENTRYPOINT ["todo-server"]
