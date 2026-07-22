FROM oven/bun:1.2 AS build

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install

COPY . .
RUN bun run build

FROM oven/bun:1.2 AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /app/package.json ./
COPY --from=build /app/next.config.mjs ./
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules ./node_modules

CMD ["bun", "run", "start", "--hostname", "0.0.0.0", "--port", "3000"]
