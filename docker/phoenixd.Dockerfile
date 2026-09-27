# phoenixd — ACINQ's minimal Lightning server (auto channels & liquidity)
# Pinned release; bump the version deliberately and re-fund carefully.
FROM eclipse-temurin:21-jre-alpine

ARG PHOENIXD_VERSION=0.6.2
WORKDIR /phoenix

RUN apk add --no-cache curl unzip \
 && curl -fsSL "https://github.com/ACINQ/phoenixd/releases/download/v${PHOENIXD_VERSION}/phoenixd-${PHOENIXD_VERSION}-linux-x64.zip" -o /tmp/phoenixd.zip \
 && unzip /tmp/phoenixd.zip -d /tmp/pd \
 && mv /tmp/pd/*/phoenixd* /phoenix/ \
 && rm -rf /tmp/phoenixd.zip /tmp/pd \
 && apk del curl unzip

VOLUME ["/phoenix/.phoenix"]
EXPOSE 9740
ENTRYPOINT ["/phoenix/phoenixd"]
