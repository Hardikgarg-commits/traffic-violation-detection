FROM python:3.13-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends nodejs npm libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
COPY requirements-ai.txt ./
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu && pip install --no-cache-dir -r requirements-ai.txt
COPY . .
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node","server.js"]
