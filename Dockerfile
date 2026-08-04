# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm install

COPY . .
ARG VITE_GOOGLE_CLIENT_ID=""
ENV VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID}
ARG VITE_EASYPAISA_RAAST_ID="984046332"
ENV VITE_EASYPAISA_RAAST_ID=${VITE_EASYPAISA_RAAST_ID}
ARG VITE_ANDROID_APP_URL=""
ENV VITE_ANDROID_APP_URL=${VITE_ANDROID_APP_URL}
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000

COPY package.json ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm install --omit=dev && npm cache clean --force

COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist

EXPOSE 4000
CMD ["npm", "run", "start"]
