# Rust 1.96 (Debian Bookworm)
FROM rust@sha256:a339861ae23e9abb272cea45dfafde21760d2ce6577a70f8a926153677902663 AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY server/Cargo.toml server/Cargo.toml
COPY server/src server/src
RUN cargo build --locked --release -p porteiro

# Debian 12 Bookworm Slim
FROM debian@sha256:e67eeead736ff7bbe258ef088bff683635c561b1fcfefad0806c1df4ab49ce0e
COPY --from=build /src/target/release/porteiro /usr/local/bin/porteiro
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/porteiro"]
