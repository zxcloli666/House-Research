FROM denoland/deno:alpine-2.9.5

WORKDIR /app
COPY deno.json* ./
COPY deno.lock* ./
COPY import_map.json* ./
COPY src ./src

CMD ["deno", "task", "prod"]