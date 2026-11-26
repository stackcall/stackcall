# Node 24 (Debian Bookworm Slim): builds the web app served at /app/.
FROM node@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530 AS web
WORKDIR /app
COPY app/package.json app/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY app/index.html app/vite.config.ts app/tsconfig.json ./
COPY app/web-public web-public
COPY app/src src
RUN npm run build:web

# Rust 1.96 (Debian Bookworm)
FROM rust@sha256:a339861ae23e9abb272cea45dfafde21760d2ce6577a70f8a926153677902663 AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY server/Cargo.toml server/Cargo.toml
COPY server/src server/src
COPY server/migrations server/migrations
# core is a workspace member: cargo needs its manifest to load the workspace (it is not compiled here).
COPY core/Cargo.toml core/Cargo.toml
COPY core/src core/src
# [patch.crates-io] points livekit at this copy: cargo needs it to resolve the workspace.
COPY vendor/livekit vendor/livekit
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --locked --release -p porteiro && cp /src/target/release/porteiro /tmp/porteiro

# Debian 12 Bookworm Slim
FROM debian@sha256:e67eeead736ff7bbe258ef088bff683635c561b1fcfefad0806c1df4ab49ce0e
COPY --from=build /tmp/porteiro /usr/local/bin/porteiro
COPY --from=web /app/dist-web /web
RUN install -d -o 65532 -g 65532 -m 0700 /data
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/porteiro"]
