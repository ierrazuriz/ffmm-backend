FROM node:20-slim

# Herramientas de compilación (para better-sqlite3 / node-gyp) + Python
RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instalar dependencias Node (con compilación de native modules)
COPY package*.json ./
RUN npm ci

# Instalar dependencias Python en venv aislado
RUN python3 -m venv /app/venv
RUN /app/venv/bin/pip install --no-cache-dir \
    google-auth \
    google-auth-oauthlib \
    google-api-python-client \
    pdfplumber

COPY . .

# Agregar venv al PATH para que Node pueda llamar python3
ENV PATH="/app/venv/bin:$PATH"

CMD ["node", "index.js"]
