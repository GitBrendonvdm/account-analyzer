# Stage 1: build the SPA. Dev dependencies are needed here and nowhere else.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: the runtime — one Node process serving dist/ and the API on 8080.
# The server imports the browser's own modules (src/lib, src/db, src/utils, src/constants.js) for
# the merge rules, so src/ ships with it; it is small and it is the point: one copy of the rules.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src ./src
EXPOSE 8080
CMD ["node", "--import", "./server/resolve.mjs", "server/index.mjs"]
