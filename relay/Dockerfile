FROM node:22.22.1-alpine3.23

WORKDIR /app
COPY package.json ./
COPY src ./src

RUN addgroup -S uniclipboard && adduser -S -G uniclipboard -h /app uniclipboard \
  && mkdir -p /var/lib/uniclipboard-mailbox \
  && chown -R uniclipboard:uniclipboard /app /var/lib/uniclipboard-mailbox

USER uniclipboard
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    DATA_DIR=/var/lib/uniclipboard-mailbox
EXPOSE 8787
VOLUME ["/var/lib/uniclipboard-mailbox"]
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8787/readyz || exit 1
CMD ["node", "src/index.mjs"]

