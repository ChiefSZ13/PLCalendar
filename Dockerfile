FROM node:22-alpine

LABEL org.opencontainers.image.title="PrairieLearn Calendar"
LABEL org.opencontainers.image.description="Private PrairieLearn-to-ICS calendar companion"
LABEL org.opencontainers.image.source="https://github.com/ChiefSZ13/PLCalendar"

WORKDIR /app

COPY --chown=node:node package.json ./
COPY --chown=node:node companion/ ./companion/
COPY --chown=node:node extension/core.js ./extension/core.js

RUN mkdir -p /app/data && chown node:node /app/data

ENV NODE_ENV=production \
    PLCALENDAR_HOST=0.0.0.0 \
    PLCALENDAR_PORT=49321 \
    PLCALENDAR_DATA_DIR=/app/data

USER node

EXPOSE 49321
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:49321/health >/dev/null || exit 1

CMD ["node", "companion/server.mjs"]
