FROM node:20-slim

# Instalar Python y dependencias del sistema
RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instalar dependencias Node
COPY package*.json ./
RUN npm ci --omit=dev

# Instalar dependencias Python en venv
RUN python3 -m venv /app/venv
RUN /app/venv/bin/pip install --no-cache-dir \
    google-auth \
    google-auth-oauthlib \
    google-api-python-client \
    pdfplumber

COPY . .

ENV PATH="/app/venv/bin:$PATH"

EXPOSE 3000
CMD ["node", "index.js"]
