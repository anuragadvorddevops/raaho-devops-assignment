FROM node:20-alpine

WORKDIR /app

# node:alpine images already ship a non-root "node" user we can reuse.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY app.js .

RUN chown -R node:node /app
USER node

EXPOSE 5000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q --spider http://localhost:5000/health || exit 1

CMD ["node", "app.js"]
