# Build dist first with npm run build, then:
# docker build -f server/Dockerfile -t block-ops .
# docker run --rm -p 4185:4185 block-ops
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY src ./src
COPY server ./server
COPY dist ./dist
ENV HOST=0.0.0.0 PORT=4185
EXPOSE 4185
USER node
CMD ["node", "server/server.mjs"]
