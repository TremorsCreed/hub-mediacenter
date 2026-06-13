FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json .
COPY src/ src/
RUN npm run build

FROM node:20-alpine
WORKDIR /app
# adb : pour le scan/déploiement d'agents sur les lecteurs Android (brique Discover)
RUN apk add --no-cache android-tools
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist dist/
RUN mkdir -p /data /apk
EXPOSE 8020
CMD ["node", "dist/index.js"]
