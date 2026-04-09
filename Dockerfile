FROM rust:alpine AS builder
WORKDIR /usr/src/app

# Build dependencies including tools for vendoring OpenSSL
RUN apk add --no-cache musl-dev pkgconfig perl make gcc g++

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
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=builder /usr/src/app/target/release/todo-server /usr/local/bin/todo-server

EXPOSE 3000
ENTRYPOINT ["todo-server"]
