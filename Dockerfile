# ---- build del frontend ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime: solo server + dist ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=8080
COPY package*.json ./
RUN npm ci --omit=dev && mkdir -p /data
COPY server ./server
COPY --from=build /app/client/dist ./client/dist
EXPOSE 8080
CMD ["node", "server/index.js"]
